// =============================================================
// adapters/qq/media — 官方富媒体 /files 上传 + msg_type=7 发送辅助
// 协议: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html
// 上传: POST /v2/users/{openid}/files | /v2/groups/{group_openid}/files
// 发送: messages 接口 msg_type=7 + media.file_info
// 本地文件走 file_data(base64);公网 URL 走 url 字段(与 nanobot/zeroclaw/botpy 对齐)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'

/** 官方 file_type */
export const QQ_FILE_TYPE_IMAGE = 1
export const QQ_FILE_TYPE_VIDEO = 2
export const QQ_FILE_TYPE_VOICE = 3
export const QQ_FILE_TYPE_FILE = 4

/** 富媒体消息 msg_type */
export const QQ_MSG_TYPE_MEDIA = 7

/** base64 直传软上限(避免撑爆内存;大文件应改分片 upload_prepare) */
export const QQ_MAX_BASE64_UPLOAD_BYTES = 20 * 1024 * 1024

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
])

export type QqMediaFileType = typeof QQ_FILE_TYPE_IMAGE | typeof QQ_FILE_TYPE_FILE

export function guessQqFileType(fileNameOrUrl: string): QqMediaFileType {
  const base = fileNameOrUrl.split('?')[0] || fileNameOrUrl
  const ext = path.extname(base).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return QQ_FILE_TYPE_IMAGE
  return QQ_FILE_TYPE_FILE
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

/** 解析 Agent 出站文本中的 [IMAGE:…] / [FILE:…] / [DOCUMENT:…] 标记 */
export function parseQqOutboundMediaMarkers(text: string): {
  cleanedText: string
  media: Array<{ kind: 'image' | 'file'; source: string; fileName?: string }>
} {
  const media: Array<{ kind: 'image' | 'file'; source: string; fileName?: string }> = []
  const re = /\[(IMAGE|PHOTO|FILE|DOCUMENT)\s*:\s*([^\]]+)\]/gi
  const cleanedText = text
    .replace(re, (_m, kindRaw: string, targetRaw: string) => {
      const source = String(targetRaw || '').trim()
      if (!source) return ''
      const kindUpper = String(kindRaw || '').toUpperCase()
      const isImage = kindUpper === 'IMAGE' || kindUpper === 'PHOTO'
      const fileName = path.basename(source.split('?')[0] || source) || undefined
      media.push({
        kind: isImage ? 'image' : 'file',
        source,
        fileName,
      })
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleanedText, media }
}

export function classifyQqMediaError(status: number, body: string): string {
  const lower = (body || '').toLowerCase()
  if (/40093002|容量上限|today.*file|file.*quota/i.test(lower) || status === 429) {
    return `QQ 富媒体发送配额/今日容量已用尽(HTTP ${status})。请明天再试或减少发送。详情: ${body.slice(0, 160)}`
  }
  if (/850031|超过.*大小|too large|size.?limit/i.test(lower)) {
    return `QQ 文件超过大小限制(HTTP ${status})。图片软限约 20MB,文件约 200MB。详情: ${body.slice(0, 160)}`
  }
  if (/850019|不支持的文件格式|unsupported.?format/i.test(lower)) {
    return `QQ 不支持该文件格式(HTTP ${status})。图片请用 png/jpg 等。详情: ${body.slice(0, 160)}`
  }
  if (/850026|下载原始文件失败|download.*fail/i.test(lower)) {
    return `QQ 无法从 URL 拉取媒体(HTTP ${status})。请确认公网可访问。详情: ${body.slice(0, 160)}`
  }
  if (/850018|禁言|muted/i.test(lower)) {
    return `QQ 群或机器人被禁言,无法发送富媒体(HTTP ${status})。详情: ${body.slice(0, 160)}`
  }
  if (/quota|频率|限流|rate.?limit|11264|11265|304023|304024|too many/i.test(lower)) {
    return `QQ 主动/群发配额已用尽或触发限流(HTTP ${status})。详情: ${body.slice(0, 160)}`
  }
  return `QQ media HTTP ${status}: ${body.slice(0, 200)}`
}

export function readLocalFileForUpload(filePath: string): { bytes: Buffer; fileName: string } {
  const resolved = path.resolve(filePath.replace(/^file:\/\//i, ''))
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`QQ 出站媒体文件不存在: ${filePath}`)
  }
  const st = fs.statSync(resolved)
  if (st.size > QQ_MAX_BASE64_UPLOAD_BYTES) {
    throw new Error(
      `QQ 本地文件过大(${st.size} bytes, base64 直传上限 ${QQ_MAX_BASE64_UPLOAD_BYTES})。请改用公网 URL 或缩小文件。`,
    )
  }
  return { bytes: fs.readFileSync(resolved), fileName: path.basename(resolved) }
}
