// =============================================================
// adapters/weixin/outbound — 文本 + [IMAGE]/[FILE] 标记 + OutboundMediaRef 统一出站
// =============================================================

import path from 'node:path'
import type { OutboundMediaRef } from '@shared/types'
import type { ILinkClient } from './ilink-client'
import { sendFileMessage, sendImageMessage } from './media'
import type { WeixinDeliveryInfo } from './parsing'

const MARKER_RE = /\[(IMAGE|PHOTO|FILE|DOCUMENT)\s*:\s*([^\]]+)\]/gi

export function parseWeixinOutboundMediaMarkers(text: string): {
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

/**
 * 统一微信出站:先发显式/标记媒体,再发剩余文本。
 * streamingKind=none 下 finalize 已是整段合并,无需再做 QwenPaw 式 outbound message_merge 缓冲。
 */
export async function sendWeixinOutbound(
  client: ILinkClient,
  delivery: WeixinDeliveryInfo,
  text: string,
  media: OutboundMediaRef[] = [],
): Promise<void> {
  const { cleanedText, media: fromMarkers } = parseWeixinOutboundMediaMarkers(text || '')
  const all = [...media, ...fromMarkers]
  for (const m of all) {
    const src = localPath((m.source || '').trim())
    if (!src) continue
    if (m.kind === 'image') {
      await sendImageMessage(client, delivery.toUserId, src, delivery.contextToken)
    } else if (m.kind === 'file' || m.kind === 'video' || m.kind === 'audio') {
      const name = m.fileName || path.basename(src.split('?')[0] || src) || 'file.bin'
      await sendFileMessage(client, delivery.toUserId, src, name, delivery.contextToken)
    }
  }
  const t = cleanedText.trim()
  if (t) {
    await client.sendText(delivery.toUserId, t, delivery.contextToken)
  }
}
