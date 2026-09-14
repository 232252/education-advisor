// =============================================================
// adapters/qq/api — QQ OpenAPI 发消息(C2C / 群) + 配额感知主动推送 + 富媒体 /files
// =============================================================

import { QQ_DEFAULT_API_BASE } from './constants'
import {
  QQ_FILE_TYPE_FILE,
  QQ_FILE_TYPE_IMAGE,
  QQ_MSG_TYPE_MEDIA,
  classifyQqMediaError,
  guessQqFileType,
  isHttpUrl,
  parseQqOutboundMediaMarkers,
  readLocalFileForUpload,
  type QqMediaFileType,
} from './media'
import type { QqDeliveryInfo } from './parsing'
import { fetchQqAccessToken, type FetchLike, type QqTokenCache } from './token'

const msgSeqMap = new Map<string, number>()

function nextMsgSeq(key: string): number {
  const n = (msgSeqMap.get(key) ?? 0) + 1
  msgSeqMap.set(key, n)
  if (msgSeqMap.size > 1000) {
    const keys = [...msgSeqMap.keys()].slice(0, 500)
    for (const k of keys) msgSeqMap.delete(k)
  }
  return n
}

/** 识别官方配额/窗口类错误,转为用户可读文案 */
export function classifyQqSendError(status: number, body: string): string {
  const lower = (body || '').toLowerCase()
  if (
    /quota|频率|限流|rate.?limit|11264|11265|304023|304024|too many/i.test(lower) ||
    status === 429
  ) {
    return `QQ 主动/群发配额已用尽或触发限流(HTTP ${status})。群主动消息配额极严;请改用飞书/钉钉/邮件,或等待配额恢复。详情: ${body.slice(0, 160)}`
  }
  if (/msg_id|reply.?window|过期|expired|304055|40034023/i.test(lower)) {
    return `QQ 被动回复窗口已过期(约 5 分钟)。请让用户再发一条消息后再回复。详情: ${body.slice(0, 160)}`
  }
  return `QQ send message HTTP ${status}: ${body.slice(0, 200)}`
}

export interface QqMediaSource {
  kind?: 'image' | 'file' | 'video' | 'audio'
  /** 本地绝对路径或 http(s) URL */
  source: string
  fileName?: string
}

export class QqApiClient {
  private tokenCache: QqTokenCache | null = null

  constructor(
    private readonly appId: string,
    private readonly clientSecret: string,
    private readonly apiBase = QQ_DEFAULT_API_BASE,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getToken(): Promise<string> {
    this.tokenCache = await fetchQqAccessToken(
      this.appId,
      this.clientSecret,
      this.fetchImpl,
      this.tokenCache,
    )
    return this.tokenCache.accessToken
  }

  async validateCredentials(): Promise<string | null> {
    try {
      await this.getToken()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /** 被动回复(带 msg_id + msg_seq) */
  async replyText(delivery: QqDeliveryInfo, text: string): Promise<void> {
    await this.sendText({
      kind: delivery.kind,
      openid: delivery.openid,
      groupOpenid: delivery.groupOpenid,
      text,
      msgId: delivery.msgId,
      seqKey: delivery.msgId,
    })
  }

  /**
   * 主动推送 — 走官方 OpenAPI(不带 msg_id)。
   * 配额耗尽时抛出可读错误,不静默拒绝。
   */
  async pushText(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    text: string
  }): Promise<void> {
    await this.sendText({
      kind: opts.kind,
      openid: opts.openid,
      groupOpenid: opts.groupOpenid,
      text: opts.text,
      seqKey: `${opts.kind}:${opts.groupOpenid || opts.openid}:push`,
    })
  }

  /**
   * 上传富媒体到官方 /files,返回 file_info。
   * - http(s) URL → url 字段由平台拉取
   * - 本地路径 → file_data base64(同 botpy/nanobot)
   */
  async uploadMedia(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    fileType: QqMediaFileType
    url?: string
    filePath?: string
    fileName?: string
  }): Promise<{ fileInfo: string; fileUuid?: string; ttl?: number }> {
    const token = await this.getToken()
    const base = this.apiBase.replace(/\/$/, '')
    const path =
      opts.kind === 'c2c'
        ? `/v2/users/${encodeURIComponent(opts.openid)}/files`
        : `/v2/groups/${encodeURIComponent(opts.groupOpenid || '')}/files`

    const body: Record<string, unknown> = {
      file_type: opts.fileType,
      srv_send_msg: false,
    }

    if (opts.url) {
      body.url = opts.url
    } else if (opts.filePath) {
      const { bytes, fileName } = readLocalFileForUpload(opts.filePath)
      body.file_data = bytes.toString('base64')
      if (opts.fileType === QQ_FILE_TYPE_FILE) {
        body.file_name = opts.fileName || fileName
      }
    } else {
      throw new Error('QQ uploadMedia 需要 url 或 filePath')
    }

    // 图片不传 file_name,避免客户端渲染成文件卡片(botpy#198 / nanobot)
    if (opts.fileType === QQ_FILE_TYPE_FILE && opts.fileName && !body.file_name) {
      body.file_name = opts.fileName
    }

    const res = await this.fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(classifyQqMediaError(res.status, t))
    }
    const data = (await res.json()) as {
      file_info?: string
      file_uuid?: string
      ttl?: number
    }
    if (!data.file_info) {
      throw new Error(`QQ /files 未返回 file_info: ${JSON.stringify(data).slice(0, 200)}`)
    }
    return { fileInfo: data.file_info, fileUuid: data.file_uuid, ttl: data.ttl }
  }

  /** 用已上传的 file_info 发 msg_type=7 */
  async sendMediaMessage(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    fileInfo: string
    msgId?: string
    seqKey: string
  }): Promise<void> {
    const token = await this.getToken()
    const base = this.apiBase.replace(/\/$/, '')
    const path =
      opts.kind === 'c2c'
        ? `/v2/users/${encodeURIComponent(opts.openid)}/messages`
        : `/v2/groups/${encodeURIComponent(opts.groupOpenid || '')}/messages`
    const body: Record<string, unknown> = {
      msg_type: QQ_MSG_TYPE_MEDIA,
      media: { file_info: opts.fileInfo },
      msg_seq: nextMsgSeq(opts.seqKey),
    }
    if (opts.msgId) body.msg_id = opts.msgId
    const res = await this.fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(classifyQqSendError(res.status, t))
    }
  }

  /** 上传并发送单条富媒体(图或文件) */
  async sendRichMedia(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    msgId?: string
    seqKey: string
    media: QqMediaSource
  }): Promise<void> {
    const source = (opts.media.source || '').trim()
    if (!source) throw new Error('QQ 富媒体 source 为空')
    const hintName = opts.media.fileName || source
    const fileType: QqMediaFileType =
      opts.media.kind === 'image'
        ? QQ_FILE_TYPE_IMAGE
        : opts.media.kind === 'file'
          ? QQ_FILE_TYPE_FILE
          : guessQqFileType(hintName)

    const uploaded = isHttpUrl(source)
      ? await this.uploadMedia({
          kind: opts.kind,
          openid: opts.openid,
          groupOpenid: opts.groupOpenid,
          fileType,
          url: source,
          fileName: opts.media.fileName,
        })
      : await this.uploadMedia({
          kind: opts.kind,
          openid: opts.openid,
          groupOpenid: opts.groupOpenid,
          fileType,
          filePath: source,
          fileName: opts.media.fileName,
        })

    await this.sendMediaMessage({
      kind: opts.kind,
      openid: opts.openid,
      groupOpenid: opts.groupOpenid,
      fileInfo: uploaded.fileInfo,
      msgId: opts.msgId,
      seqKey: opts.seqKey,
    })
  }

  /** 被动回复富媒体 */
  async replyMedia(delivery: QqDeliveryInfo, media: QqMediaSource): Promise<void> {
    await this.sendRichMedia({
      kind: delivery.kind,
      openid: delivery.openid,
      groupOpenid: delivery.groupOpenid,
      msgId: delivery.msgId,
      seqKey: `${delivery.msgId}:media`,
      media,
    })
  }

  /** 主动推送富媒体 */
  async pushMedia(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    media: QqMediaSource
  }): Promise<void> {
    await this.sendRichMedia({
      kind: opts.kind,
      openid: opts.openid,
      groupOpenid: opts.groupOpenid,
      seqKey: `${opts.kind}:${opts.groupOpenid || opts.openid}:media`,
      media: opts.media,
    })
  }

  /**
   * 统一出站:先发显式 media,再解析文本中的 [IMAGE:]/[FILE:] 标记,最后发剩余文本。
   */
  async replyOutbound(
    delivery: QqDeliveryInfo,
    text: string,
    media: QqMediaSource[] = [],
  ): Promise<void> {
    const { cleanedText, media: fromMarkers } = parseQqOutboundMediaMarkers(text || '')
    const all = [...media, ...fromMarkers]
    for (const m of all) {
      await this.replyMedia(delivery, m)
    }
    const t = cleanedText.trim()
    if (t) await this.replyText(delivery, t)
  }

  async pushOutbound(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    text: string
    media?: QqMediaSource[]
  }): Promise<void> {
    const { cleanedText, media: fromMarkers } = parseQqOutboundMediaMarkers(opts.text || '')
    const all = [...(opts.media || []), ...fromMarkers]
    for (const m of all) {
      await this.pushMedia({
        kind: opts.kind,
        openid: opts.openid,
        groupOpenid: opts.groupOpenid,
        media: m,
      })
    }
    const t = cleanedText.trim()
    if (t) {
      await this.pushText({
        kind: opts.kind,
        openid: opts.openid,
        groupOpenid: opts.groupOpenid,
        text: t,
      })
    }
  }

  private async sendText(opts: {
    kind: 'c2c' | 'group'
    openid: string
    groupOpenid?: string
    text: string
    msgId?: string
    seqKey: string
  }): Promise<void> {
    const token = await this.getToken()
    const base = this.apiBase.replace(/\/$/, '')
    const path =
      opts.kind === 'c2c'
        ? `/v2/users/${encodeURIComponent(opts.openid)}/messages`
        : `/v2/groups/${encodeURIComponent(opts.groupOpenid || '')}/messages`
    const body: Record<string, unknown> = {
      content: opts.text,
      msg_type: 0,
      msg_seq: nextMsgSeq(opts.seqKey),
    }
    if (opts.msgId) body.msg_id = opts.msgId
    const res = await this.fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(classifyQqSendError(res.status, t))
    }
  }
}
