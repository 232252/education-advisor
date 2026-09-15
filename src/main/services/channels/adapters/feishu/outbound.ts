// =============================================================
// adapters/feishu/outbound — 文本 + 图片/文件出站(QwenPaw send_image/send_file 对齐)
// 上传走 Open API multipart;发送走 im.message.reply / im.message.create。
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import type * as lark from '@larksuiteoapi/node-sdk'
import type { OutboundMediaRef } from '@shared/types'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { FEISHU_FILE_MAX_BYTES } from './constants'
import { getFeishuBase } from './http-instance'
import { sendReply } from './reply'

const MARKER_RE = /\[(IMAGE|PHOTO|FILE|DOCUMENT)\s*:\s*([^\]]+)\]/gi

export function parseFeishuOutboundMediaMarkers(text: string): {
  cleanedText: string
  media: OutboundMediaRef[]
} {
  const media: OutboundMediaRef[] = []
  const cleanedText = (text || '')
    .replace(MARKER_RE, (_m, kindRaw: string, targetRaw: string) => {
      const source = String(targetRaw || '').trim()
      if (!source) return ''
      const kindUpper = String(kindRaw || '').toUpperCase()
      const isImage = kindUpper === 'IMAGE' || kindUpper === 'PHOTO'
      media.push({
        kind: isImage ? 'image' : 'file',
        source,
        fileName: path.basename(source.split('?')[0] || source) || undefined,
      })
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleanedText, media }
}

function localPath(source: string): string {
  return source.replace(/^file:\/\//i, '')
}

function guessFileType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, '')
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx') return 'doc'
  if (ext === 'xls' || ext === 'xlsx') return 'xls'
  if (ext === 'ppt' || ext === 'pptx') return 'ppt'
  if (ext === 'ogg' || ext === 'opus') return 'opus'
  if (ext === 'mp4') return 'mp4'
  return 'stream'
}

async function readBytes(source: string): Promise<{ bytes: Buffer; fileName: string } | null> {
  const src = localPath(source.trim())
  if (!src) return null
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      const name =
        path.basename(new URL(src).pathname) ||
        (res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] ?? 'download.bin')
      return { bytes: buf, fileName: name }
    } catch (err) {
      log('warn', 'feishu-bot', `outbound fetch url failed: ${errText(err)}`)
      return null
    }
  }
  try {
    if (!fs.existsSync(src)) return null
    const bytes = fs.readFileSync(src)
    return { bytes, fileName: path.basename(src) }
  } catch (err) {
    log('warn', 'feishu-bot', `outbound read file failed: ${errText(err)}`)
    return null
  }
}

async function uploadImage(token: string, bytes: Buffer, fileName: string): Promise<string | null> {
  if (bytes.byteLength > FEISHU_FILE_MAX_BYTES) {
    log('warn', 'feishu-bot', `outbound image too large: ${bytes.byteLength}`)
    return null
  }
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([new Uint8Array(bytes)]), fileName || 'image.png')
  try {
    const res = await fetch(`${getFeishuBase()}/open-apis/im/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    const json = (await res.json()) as { code?: number; msg?: string; data?: { image_key?: string } }
    if (json.code !== 0 || !json.data?.image_key) {
      log('warn', 'feishu-bot', `image upload failed: code=${json.code} msg=${json.msg ?? ''}`)
      return null
    }
    return json.data.image_key
  } catch (err) {
    log('warn', 'feishu-bot', `image upload error: ${errText(err)}`)
    return null
  }
}

async function uploadFile(
  token: string,
  bytes: Buffer,
  fileName: string,
): Promise<string | null> {
  if (bytes.byteLength > FEISHU_FILE_MAX_BYTES) {
    log('warn', 'feishu-bot', `outbound file too large: ${bytes.byteLength}`)
    return null
  }
  const form = new FormData()
  form.append('file_type', guessFileType(fileName))
  form.append('file_name', fileName || 'file.bin')
  form.append('file', new Blob([new Uint8Array(bytes)]), fileName || 'file.bin')
  try {
    const res = await fetch(`${getFeishuBase()}/open-apis/im/v1/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    const json = (await res.json()) as { code?: number; msg?: string; data?: { file_key?: string } }
    if (json.code !== 0 || !json.data?.file_key) {
      log('warn', 'feishu-bot', `file upload failed: code=${json.code} msg=${json.msg ?? ''}`)
      return null
    }
    return json.data.file_key
  } catch (err) {
    log('warn', 'feishu-bot', `file upload error: ${errText(err)}`)
    return null
  }
}

async function replyRaw(
  sdkClient: lark.Client | null,
  messageId: string,
  msgType: string,
  content: Record<string, unknown>,
): Promise<void> {
  if (!sdkClient) return
  try {
    const res = (await sdkClient.im.message.reply({
      data: { msg_type: msgType, content: JSON.stringify(content) },
      path: { message_id: messageId },
    })) as { code?: number; msg?: string }
    if (typeof res.code === 'number' && res.code !== 0) {
      log('warn', 'feishu-bot', `media reply rejected: code=${res.code} msg=${res.msg ?? ''}`)
    }
  } catch (err) {
    log('warn', 'feishu-bot', `media reply error: ${errText(err)}`)
  }
}

/**
 * 回复路径出站:先媒体后文本(与微信/QQ / QwenPaw Feishu 一致)。
 * token 缺失时仅发文本,媒体静默跳过并记日志。
 */
export async function sendFeishuOutboundReply(opts: {
  sdkClient: lark.Client | null
  getAccessToken: () => Promise<string | null>
  messageId: string
  text: string
  media?: OutboundMediaRef[]
}): Promise<void> {
  const { cleanedText, media: fromMarkers } = parseFeishuOutboundMediaMarkers(opts.text || '')
  const all = [...(opts.media ?? []), ...fromMarkers]
  const token = all.length ? await opts.getAccessToken() : null
  for (const m of all) {
    const loaded = await readBytes(m.source || '')
    if (!loaded || !token) {
      log('warn', 'feishu-bot', `skip outbound media (token/file missing): ${m.source}`)
      continue
    }
    if (m.kind === 'image') {
      const key = await uploadImage(token, loaded.bytes, m.fileName || loaded.fileName)
      if (key) await replyRaw(opts.sdkClient, opts.messageId, 'image', { image_key: key })
    } else {
      const name = m.fileName || loaded.fileName || 'file.bin'
      const key = await uploadFile(token, loaded.bytes, name)
      if (key) await replyRaw(opts.sdkClient, opts.messageId, 'file', { file_key: key })
    }
  }
  const t = cleanedText.trim()
  if (t) await sendReply(opts.sdkClient, opts.messageId, t)
}

/** 主动推送:chat_id 创建消息 + 可选媒体 */
export async function sendFeishuOutboundPush(opts: {
  sdkClient: lark.Client
  getAccessToken: () => Promise<string | null>
  chatId: string
  text: string
  media?: OutboundMediaRef[]
}): Promise<{ messageId?: string }> {
  const { cleanedText, media: fromMarkers } = parseFeishuOutboundMediaMarkers(opts.text || '')
  const all = [...(opts.media ?? []), ...fromMarkers]
  const token = all.length ? await opts.getAccessToken() : null
  let lastId: string | undefined
  for (const m of all) {
    const loaded = await readBytes(m.source || '')
    if (!loaded || !token) continue
    let msgType = 'file'
    let content: Record<string, unknown> = {}
    if (m.kind === 'image') {
      const key = await uploadImage(token, loaded.bytes, m.fileName || loaded.fileName)
      if (!key) continue
      msgType = 'image'
      content = { image_key: key }
    } else {
      const name = m.fileName || loaded.fileName || 'file.bin'
      const key = await uploadFile(token, loaded.bytes, name)
      if (!key) continue
      content = { file_key: key }
    }
    const res = (await opts.sdkClient.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: opts.chatId,
        msg_type: msgType,
        content: JSON.stringify(content),
      },
    })) as { code?: number; msg?: string; data?: { message_id?: string } }
    if (typeof res.code === 'number' && res.code !== 0) {
      throw new Error(`飞书推送媒体失败(code=${res.code}): ${res.msg ?? ''}`)
    }
    lastId = res.data?.message_id ?? lastId
  }
  const t = cleanedText.trim()
  if (t) {
    const res = (await opts.sdkClient.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: opts.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: t }),
      },
    })) as { code?: number; msg?: string; data?: { message_id?: string } }
    if (typeof res.code === 'number' && res.code !== 0) {
      throw new Error(`飞书推送失败(code=${res.code}): ${res.msg ?? ''}`)
    }
    lastId = res.data?.message_id ?? lastId
  }
  return { messageId: lastId }
}
