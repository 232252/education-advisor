// =============================================================
// yuanbao/media — COS pre-signed upload via genUploadInfo (QwenPaw media.py)
// Flow: genUploadInfo → PUT COS (HMAC-SHA1) → CDN resourceUrl → TIMImage/TIMFile
// =============================================================

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const UPLOAD_INFO_PATH = '/api/resource/genUploadInfo'
export const DOWNLOAD_INFO_PATH = '/api/resource/v1/download'
export const MAX_UPLOAD_MB = 20

export interface CosUploadConfig {
  bucketName: string
  region: string
  location: string
  secretId: string
  secretKey: string
  token: string
  startTime: number
  expiredTime: number
  resourceUrl: string
  resourceId: string
}

export interface UploadResult {
  url: string
  filename: string
  size: number
  mimeType: string
  uuidHex: string
  width: number
  height: number
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.amr': 'audio/amr',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
}

export function guessMime(filename: string): string {
  return MIME_MAP[extname(filename).toLowerCase()] ?? 'application/octet-stream'
}

function hmacSha1Hex(key: string, message: string): string {
  return createHmac('sha1', key).update(message, 'utf8').digest('hex')
}

function sha1Hex(data: string): string {
  return createHash('sha1').update(data, 'utf8').digest('hex')
}

/** Parse PNG/JPEG dimensions from raw bytes. Returns [width, height]. */
export function parseImageSize(data: Uint8Array): [number, number] {
  if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const width = (data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!
    const height = (data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!
    return [width >>> 0, height >>> 0]
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2
    while (i < data.length - 9) {
      if (data[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = data[i + 1]!
      if (marker === 0xc0 || marker === 0xc2) {
        const height = (data[i + 5]! << 8) | data[i + 6]!
        const width = (data[i + 7]! << 8) | data[i + 8]!
        return [width, height]
      }
      if (i + 3 < data.length) {
        const segLen = (data[i + 2]! << 8) | data[i + 3]!
        i += 2 + segLen
      } else {
        break
      }
    }
  }
  return [0, 0]
}

/** Generate COS Authorization header (HMAC-SHA1). Exported for unit tests. */
export function signCosRequest(opts: {
  secretId: string
  secretKey: string
  method: string
  pathname: string
  headers: Record<string, string>
  startTime: number
  expiredTime: number
}): string {
  const keyTime = `${opts.startTime};${opts.expiredTime}`
  const signKey = hmacSha1Hex(opts.secretKey, keyTime)
  const sortedHeaderKeys = Object.keys(opts.headers)
    .map((k) => k.toLowerCase())
    .sort()
  const headerList = sortedHeaderKeys.join(';')
  const httpHeaders = sortedHeaderKeys
    .map((k) => {
      const orig = Object.keys(opts.headers).find((h) => h.toLowerCase() === k)!
      return `${k}=${encodeURIComponent(opts.headers[orig]!).replace(/%20/g, '%20')}`
    })
    .join('&')
  const httpString = `${opts.method.toLowerCase()}\n${opts.pathname}\n\n${httpHeaders}\n`
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(httpString)}\n`
  const signature = hmacSha1Hex(signKey, stringToSign)
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${opts.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&')
}

function normalizeApiDomain(apiDomain: string): string {
  let domain = apiDomain.trim().replace(/\/$/, '')
  if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
    domain = `https://${domain}`
  }
  return domain
}

export async function getUploadInfo(
  fetchImpl: FetchLike,
  apiDomain: string,
  authHeaders: Record<string, string>,
  filename: string,
): Promise<CosUploadConfig> {
  const url = `${normalizeApiDomain(apiDomain)}${UPLOAD_INFO_PATH}`
  const fileId = randomBytes(16).toString('hex')
  const body = {
    fileName: filename,
    fileId,
    docFrom: 'localDoc',
    docOpenId: '',
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`genUploadInfo failed: ${res.status} ${text.slice(0, 200)}`)
  }
  let data = (await res.json()) as Record<string, unknown>
  if (data.data && typeof data.data === 'object') data = data.data as Record<string, unknown>
  const bucket = String(data.bucketName ?? '')
  const location = String(data.location ?? '')
  if (!bucket || !location) throw new Error(`genUploadInfo incomplete: ${JSON.stringify(data)}`)
  const now = Math.floor(Date.now() / 1000)
  return {
    bucketName: bucket,
    region: String(data.region ?? ''),
    location,
    secretId: String(data.encryptTmpSecretId ?? ''),
    secretKey: String(data.encryptTmpSecretKey ?? ''),
    token: String(data.encryptToken ?? ''),
    startTime: Number(data.startTime ?? now),
    expiredTime: Number(data.expiredTime ?? now + 1800),
    resourceUrl: String(data.resourceUrl ?? ''),
    resourceId: String(data.resourceID ?? data.resourceId ?? ''),
  }
}

export async function uploadToCos(
  fetchImpl: FetchLike,
  config: CosUploadConfig,
  data: Uint8Array,
  mimeType: string,
): Promise<string> {
  const pathname = config.location.startsWith('/') ? config.location : `/${config.location}`
  const host = `${config.bucketName}.cos.${config.region}.myqcloud.com`
  const signHeaders: Record<string, string> = {
    host,
    'content-length': String(data.byteLength),
  }
  const extraHeaders: Record<string, string> = {}
  if (mimeType.startsWith('image/')) {
    extraHeaders['Content-Type'] = mimeType
    extraHeaders['Pic-Operations'] = JSON.stringify({
      is_pic_info: 1,
      rules: [{ fileid: config.location, rule: 'imageMogr2/format/jpg' }],
    })
  } else {
    extraHeaders['Content-Type'] = 'application/octet-stream'
  }
  if (config.token) {
    signHeaders['x-cos-security-token'] = config.token
    extraHeaders['x-cos-security-token'] = config.token
  }
  const authorization = signCosRequest({
    secretId: config.secretId,
    secretKey: config.secretKey,
    method: 'PUT',
    pathname,
    headers: signHeaders,
    startTime: config.startTime,
    expiredTime: config.expiredTime,
  })
  const url = `https://${host}${pathname}`
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { ...extraHeaders, Authorization: authorization },
    body: Buffer.from(data),
  })
  if (res.status !== 200 && res.status !== 204) {
    const body = await res.text()
    throw new Error(`COS upload failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return config.resourceUrl
}

export interface ParsedDataUrl {
  mediaType: string
  data: Uint8Array
  suffix: string
}

export function parseDataUrl(mediaPath: string): ParsedDataUrl | null {
  const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(mediaPath)
  if (!m) return null
  const mediaType = (m[1] || 'application/octet-stream').toLowerCase()
  const data = Buffer.from(m[2]!, 'base64')
  const suffix =
    Object.entries(MIME_MAP).find(([, v]) => v === mediaType)?.[0] ??
    (mediaType.startsWith('image/') ? `.${mediaType.slice(6)}` : '.bin')
  return { mediaType, data, suffix }
}

export function fileUrlToLocalPath(url: string): string | null {
  if (!url) return null
  if (url.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    } catch {
      return null
    }
  }
  // Absolute Windows or POSIX paths
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('\\\\')) {
    return url
  }
  return null
}

export async function downloadAndUploadMedia(
  mediaPath: string,
  fetchImpl: FetchLike,
  apiDomain: string,
  authHeaders: Record<string, string>,
): Promise<UploadResult> {
  let fileData: Uint8Array
  let filename: string
  let mimeFromData: string | undefined

  const dataMedia = parseDataUrl(mediaPath)
  const localPath = dataMedia ? null : fileUrlToLocalPath(mediaPath)

  if (dataMedia) {
    fileData = dataMedia.data
    filename = `file${dataMedia.suffix}`
    mimeFromData = dataMedia.mediaType
  } else if (localPath) {
    fileData = await readFile(localPath)
    filename = basename(localPath)
  } else if (mediaPath.startsWith('http://') || mediaPath.startsWith('https://')) {
    const res = await fetchImpl(mediaPath)
    if (!res.ok) throw new Error(`Failed to download media: ${res.status}`)
    fileData = new Uint8Array(await res.arrayBuffer())
    try {
      filename = basename(new URL(mediaPath).pathname) || 'file'
    } catch {
      filename = 'file'
    }
  } else {
    throw new Error(`Cannot resolve media path: ${mediaPath}`)
  }

  const maxBytes = MAX_UPLOAD_MB * 1024 * 1024
  if (fileData.byteLength > maxBytes) {
    throw new Error(
      `File too large: ${(fileData.byteLength / 1024 / 1024).toFixed(1)} MB > ${MAX_UPLOAD_MB} MB`,
    )
  }

  const mimeType = mimeFromData ?? guessMime(filename)
  const uuidHex = createHash('md5').update(fileData).digest('hex')
  let width = 0
  let height = 0
  if (mimeType.startsWith('image/')) {
    ;[width, height] = parseImageSize(fileData)
  }

  const cosConfig = await getUploadInfo(fetchImpl, apiDomain, authHeaders, filename)
  const resourceUrl = await uploadToCos(fetchImpl, cosConfig, fileData, mimeType)

  return {
    url: resourceUrl,
    filename,
    size: fileData.byteLength,
    mimeType,
    uuidHex,
    width,
    height,
  }
}

export function buildImageMsgBody(result: UploadResult): Array<{
  msg_type: string
  msg_content: Record<string, unknown>
}> {
  return [
    {
      msg_type: 'TIMImageElem',
      msg_content: {
        uuid: result.uuidHex,
        image_format: 255,
        image_info_array: [
          {
            type: 1,
            size: result.size,
            width: result.width,
            height: result.height,
            url: result.url,
          },
        ],
      },
    },
  ]
}

export function buildFileMsgBody(result: UploadResult): Array<{
  msg_type: string
  msg_content: Record<string, unknown>
}> {
  return [
    {
      msg_type: 'TIMFileElem',
      msg_content: {
        uuid: result.uuidHex,
        file_name: result.filename,
        file_size: result.size,
        url: result.url,
      },
    },
  ]
}

export function extractResourceId(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('resourceId')
  } catch {
    return null
  }
}

export async function resolveDownloadUrl(
  mediaUrl: string,
  fetchImpl: FetchLike,
  apiDomain: string,
  authHeaders: Record<string, string>,
): Promise<string> {
  const resourceId = extractResourceId(mediaUrl)
  if (!resourceId) return mediaUrl
  const url = new URL(`${normalizeApiDomain(apiDomain)}${DOWNLOAD_INFO_PATH}`)
  url.searchParams.set('resourceId', resourceId)
  try {
    const res = await fetchImpl(url.toString(), { headers: authHeaders })
    if (!res.ok) return mediaUrl
    let data = (await res.json()) as Record<string, unknown>
    if (data.data && typeof data.data === 'object') data = data.data as Record<string, unknown>
    const downloadUrl = String(data.url ?? data.realUrl ?? '')
    return downloadUrl || mediaUrl
  } catch {
    return mediaUrl
  }
}

/** Classify TIMFileElem filename as audio vs file (QwenPaw _AUDIO_EXTS). */
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.opus', '.silk', '.amr', '.aac', '.flac'])

export function classifyFileKind(filename: string): 'audio' | 'file' {
  return AUDIO_EXTS.has(extname(filename).toLowerCase()) ? 'audio' : 'file'
}

/** Extract media URL from OutboundContent-like shapes used by EA. */
export function extractOutboundMediaUrl(content: {
  kind?: string
  url?: string
  imageUrl?: string
  fileUrl?: string
  audioUrl?: string
  videoUrl?: string
  path?: string
  dataUrl?: string
}): string {
  return (
    content.url ||
    content.imageUrl ||
    content.fileUrl ||
    content.audioUrl ||
    content.videoUrl ||
    content.path ||
    content.dataUrl ||
    ''
  )
}

export function localPathAsFileUri(localPath: string): string {
  return pathToFileURL(localPath).href
}
