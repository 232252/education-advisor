// =============================================================
// adapters/weixin/media — CDN 下载/上传 + send_image / send_file
// 协议: getuploadurl + novac2c.cdn.weixin.qq.com + AES-128-ECB
// =============================================================

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  WEIXIN_CDN_BASE,
  WEIXIN_CHANNEL_VERSION,
  WEIXIN_ITEM_TYPE_FILE,
  WEIXIN_ITEM_TYPE_IMAGE,
  WEIXIN_MEDIA_TYPE_FILE,
  WEIXIN_MEDIA_TYPE_IMAGE,
  WEIXIN_MSG_STATE_FINISH,
  WEIXIN_MSG_TYPE_BOT,
} from './constants'
import type { ILinkClient } from './ilink-client'
import { aesEcbDecrypt, aesEcbEncrypt, generateRawAesKeyB64 } from './media-crypto'

export interface UploadedMedia {
  encryptQueryParam: string
  /** sendmessage 用: base64(hex_string) */
  aesKeyForMsg: string
  filesize: number
}

export async function downloadILinkMedia(
  client: ILinkClient,
  opts: {
    encryptQueryParam?: string
    url?: string
    aesKey?: string
    destPath: string
  },
): Promise<{ bytes: number }> {
  let downloadUrl = ''
  const enc = (opts.encryptQueryParam || '').trim()
  if (enc) {
    downloadUrl = `${WEIXIN_CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(enc)}`
  } else if (opts.url && /^https?:\/\//i.test(opts.url)) {
    downloadUrl = opts.url
  } else {
    throw new Error('Cannot download media: no valid HTTP URL or encrypt_query_param')
  }
  const res = await client.rawFetch(downloadUrl, { method: 'GET', timeoutMs: 60_000, auth: false })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`CDN download HTTP ${res.status}: ${t.slice(0, 160)}`)
  }
  let buf: Buffer = Buffer.from(await res.arrayBuffer())
  if (opts.aesKey) {
    buf = Buffer.from(aesEcbDecrypt(buf, opts.aesKey))
  }
  fs.mkdirSync(path.dirname(opts.destPath), { recursive: true })
  fs.writeFileSync(opts.destPath, buf)
  return { bytes: buf.length }
}

export async function uploadILinkMedia(
  client: ILinkClient,
  filePath: string,
  mediaType: number,
  toUserId: string,
): Promise<UploadedMedia> {
  const rawData = fs.readFileSync(filePath)
  const rawfilemd5 = createHash('md5').update(rawData).digest('hex')
  const aesKeyRaw = Buffer.from(generateRawAesKeyB64(), 'base64')
  const aesKeyHex = aesKeyRaw.toString('hex')
  // sendmessage: base64(hex_string) — 与 picoclaw / qwenpaw 对齐
  const aesKeyForMsg = Buffer.from(aesKeyHex, 'utf8').toString('base64')
  const aesKeyB64ForEncrypt = aesKeyRaw.toString('base64')
  const filekey = randomBytes(16).toString('hex')
  const encrypted = aesEcbEncrypt(rawData, aesKeyB64ForEncrypt)
  const filesize = encrypted.length

  const uploadResp = await client.getUploadUrl({
    filekey,
    mediaType,
    toUserId,
    rawsize: rawData.length,
    rawfilemd5,
    filesize,
    aeskey: aesKeyHex,
  })

  let uploadUrl = String(uploadResp.upload_full_url ?? '')
  if (!uploadUrl) {
    const uploadParam = String(uploadResp.upload_param ?? '')
    if (!uploadParam) {
      throw new Error(`getuploadurl missing upload_full_url/upload_param: ${JSON.stringify(uploadResp).slice(0, 200)}`)
    }
    uploadUrl = `${WEIXIN_CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${filekey}`
  }

  const upRes = await client.rawFetch(uploadUrl, {
    method: 'POST',
    body: new Uint8Array(encrypted),
    headers: { 'Content-Type': 'application/octet-stream' },
    timeoutMs: 60_000,
    auth: false,
  })
  if (!upRes.ok) {
    const t = await upRes.text().catch(() => '')
    throw new Error(`CDN upload HTTP ${upRes.status}: ${t.slice(0, 160)}`)
  }
  const encryptQueryParam =
    upRes.headers.get('x-encrypted-param') ||
    upRes.headers.get('X-Encrypted-Param') ||
    upRes.headers.get('encrypted_query_param') ||
    ''
  // 部分 CDN 把参数放在 JSON body
  let fromBody = ''
  try {
    const j = (await upRes.clone().json()) as Record<string, unknown>
    fromBody = String(j.encrypt_query_param ?? j.encrypted_query_param ?? '')
  } catch {
    /* not json */
  }
  const finalParam = (encryptQueryParam || fromBody || String(uploadResp.upload_param ?? '')).trim()
  if (!finalParam) {
    throw new Error('upload_media failed: CDN did not return encrypt_query_param')
  }
  return { encryptQueryParam: finalParam, aesKeyForMsg, filesize }
}

export async function sendImageMessage(
  client: ILinkClient,
  toUserId: string,
  imagePath: string,
  contextToken: string,
): Promise<Record<string, unknown>> {
  if (!contextToken) throw new Error('微信发图需要 context_token')
  const uploaded = await uploadILinkMedia(client, imagePath, WEIXIN_MEDIA_TYPE_IMAGE, toUserId)
  const msg = {
    from_user_id: '',
    to_user_id: toUserId,
    client_id: randomUUID(),
    message_type: WEIXIN_MSG_TYPE_BOT,
    message_state: WEIXIN_MSG_STATE_FINISH,
    context_token: contextToken,
    item_list: [
      {
        type: WEIXIN_ITEM_TYPE_IMAGE,
        image_item: {
          media: {
            encrypt_query_param: uploaded.encryptQueryParam,
            aes_key: uploaded.aesKeyForMsg,
          },
          mid_size: uploaded.filesize,
        },
      },
    ],
  }
  return client.sendRawMessage(msg)
}

export async function sendFileMessage(
  client: ILinkClient,
  toUserId: string,
  filePath: string,
  filename: string,
  contextToken: string,
): Promise<Record<string, unknown>> {
  if (!contextToken) throw new Error('微信发文件需要 context_token')
  const uploaded = await uploadILinkMedia(client, filePath, WEIXIN_MEDIA_TYPE_FILE, toUserId)
  const msg = {
    from_user_id: '',
    to_user_id: toUserId,
    client_id: randomUUID(),
    message_type: WEIXIN_MSG_TYPE_BOT,
    message_state: WEIXIN_MSG_STATE_FINISH,
    context_token: contextToken,
    item_list: [
      {
        type: WEIXIN_ITEM_TYPE_FILE,
        file_item: {
          media: {
            encrypt_query_param: uploaded.encryptQueryParam,
            aes_key: uploaded.aesKeyForMsg,
          },
          file_name: filename,
          len: String(uploaded.filesize),
        },
      },
    ],
  }
  return client.sendRawMessage(msg)
}

