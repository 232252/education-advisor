// =============================================================
// adapters/feishu/api — 直连 fetch 的飞书 OpenAPI 封装(阶段 0)
// (M3 从 feishu-bot/feishu-api.ts 搬入,不变;原文件改为 re-export 壳)
// 仅覆盖 node-sdk 未覆盖/不便覆盖的接口:
//   - CardKit v1 卡片实体(创建流式卡片 / 更新元素文本 / 关闭流式)
//     官方流式方案,见 docs/research/2026-09-12 §2.2
//   - 消息资源文件下载(file/image,im:resource)
// 所有函数失败时返回 null/false 并记日志,由调用方降级
// (流式卡片失败 → 纯文本占位+最终回复;下载失败 → 回复中告知)。
// =============================================================

import { randomUUID } from 'node:crypto'
import type * as lark from '@larksuiteoapi/node-sdk'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { MAX_DOWNLOAD_BYTES, STREAM_CARD_TEXT_LIMIT } from './constants'
import { getFeishuBase } from './http-instance'

/** 流式文本元素固定的 element_id(创建卡片时指定,更新时引用) */
const STREAM_ELEMENT_ID = 'content'
const CARD_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 60_000

/** 飞书业务响应公共结构(code=0 成功) */
interface FeishuBizResponse {
  code?: number
  msg?: string
  data?: { card_id?: string }
}

function isBizOk(json: FeishuBizResponse | null): boolean {
  return !!json && (json.code === 0 || json.code === undefined)
}

/** 带鉴权的 JSON API 请求(失败抛错,由调用方捕获降级) */
async function apiFetch(
  path: string,
  opts: { method: string; token: string; body?: unknown },
): Promise<FeishuBizResponse | null> {
  const res = await fetch(`${getFeishuBase()}${path}`, {
    method: opts.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(CARD_TIMEOUT_MS),
  })
  return (await res.json()) as FeishuBizResponse
}

/**
 * 创建 CardKit 流式卡片实体(schema 2.0, streaming_mode)。
 * @returns card_id;失败(无 cardkit:card:write 权限等)返回 null
 */
export async function createStreamingCard(
  token: string,
  placeholderText: string,
  summaryText: string,
): Promise<string | null> {
  const card = {
    schema: '2.0',
    config: {
      streaming_mode: true,
      update_multi: true,
      summary: { content: summaryText },
      streaming_config: { print_frequency_ms: { default: 50 }, print_step: { default: 2 } },
    },
    body: {
      elements: [{ tag: 'markdown', content: placeholderText, element_id: STREAM_ELEMENT_ID }],
    },
  }
  try {
    const json = await apiFetch('/open-apis/cardkit/v1/cards', {
      method: 'post',
      token,
      body: { type: 'card_json', data: JSON.stringify(card) },
    })
    const cardId = json?.data?.card_id
    if (!isBizOk(json) || !cardId) {
      log(
        'warn',
        'feishu-bot',
        `createStreamingCard failed: code=${json?.code} msg=${json?.msg ?? ''} (需 cardkit:card:write 权限)`,
      )
      return null
    }
    return cardId
  } catch (err) {
    log('warn', 'feishu-bot', `createStreamingCard error: ${errText(err)}`)
    return null
  }
}

/** 用 im.message.reply 把卡片实体回复到原消息(占位即秒回) */
export async function sendCardReply(
  sdkClient: lark.Client | null,
  messageId: string,
  cardId: string,
): Promise<boolean> {
  if (!sdkClient) return false
  try {
    const res = (await sdkClient.im.message.reply({
      data: {
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
      },
      path: { message_id: messageId },
    })) as { code?: number; msg?: string }
    if (res && typeof res.code === 'number' && res.code !== 0) {
      log('warn', 'feishu-bot', `card reply rejected: code=${res.code} msg=${res.msg ?? ''}`)
      return false
    }
    return true
  } catch (err) {
    log('warn', 'feishu-bot', `card reply error: ${errText(err)}`)
    return false
  }
}

/** 截断到卡片 30KB 限制内(按序列化后实际体积预留余量) */
function clampCardText(text: string): string {
  if (text.length <= STREAM_CARD_TEXT_LIMIT) return text
  return `${text.slice(0, STREAM_CARD_TEXT_LIMIT)}\n\n…(内容过长,已截断)`
}

/**
 * 流式更新卡片文本元素。
 * 官方语义:content 传全量文本(非增量);sequence 必须严格递增(错误 300317)。
 */
export async function updateCardElement(
  token: string,
  cardId: string,
  fullText: string,
  sequence: number,
): Promise<boolean> {
  try {
    const json = await apiFetch(
      `/open-apis/cardkit/v1/cards/${cardId}/elements/${STREAM_ELEMENT_ID}/content`,
      {
        method: 'put',
        token,
        body: { uuid: randomUUID(), content: clampCardText(fullText), sequence },
      },
    )
    if (!isBizOk(json)) {
      // 频控/sequence 冲突等失败跳过本次(下次更新仍传全量,自然补齐)
      log('debug', 'feishu-bot', `stream update skipped: code=${json?.code} msg=${json?.msg ?? ''}`)
      return false
    }
    return true
  } catch (err) {
    log('debug', 'feishu-bot', `stream update error: ${errText(err)}`)
    return false
  }
}

/** 关闭流式模式并更新会话列表预览(结束后必须调用,否则 10 分钟后自动关且卡片不可转发) */
export async function closeCardStream(
  token: string,
  cardId: string,
  sequence: number,
  summaryText: string,
): Promise<boolean> {
  try {
    const json = await apiFetch(`/open-apis/cardkit/v1/cards/${cardId}/settings`, {
      method: 'patch',
      token,
      body: {
        uuid: randomUUID(),
        sequence,
        settings: JSON.stringify({
          config: { streaming_mode: false, summary: { content: summaryText } },
        }),
      },
    })
    if (!isBizOk(json)) {
      log('warn', 'feishu-bot', `close stream failed: code=${json?.code} msg=${json?.msg ?? ''}`)
      return false
    }
    return true
  } catch (err) {
    log('warn', 'feishu-bot', `close stream error: ${errText(err)}`)
    return false
  }
}

/**
 * 下载消息中的资源文件(file/image)。
 * 需要应用具备「获取消息中的资源文件」权限(im:resource)。
 * @returns 文件字节;失败返回 null
 */
export async function downloadResource(
  token: string,
  messageId: string,
  fileKey: string,
  type: 'file' | 'image',
): Promise<Uint8Array | null> {
  const url = `${getFeishuBase()}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${type}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok) {
      log('warn', 'feishu-bot', `download resource http ${res.status} (${type} ${fileKey})`)
      return null
    }
    // 失败时飞书返回 JSON 业务错误(如缺权限),成功返回二进制
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as FeishuBizResponse
      log(
        'warn',
        'feishu-bot',
        `download resource rejected: code=${json.code} msg=${json.msg ?? ''} (需 im:resource 权限)`,
      )
      return null
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_DOWNLOAD_BYTES) {
      log('warn', 'feishu-bot', `resource too large: ${declared} bytes, skip`)
      return null
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
      log('warn', 'feishu-bot', `resource too large: ${buf.byteLength} bytes, skip`)
      return null
    }
    return buf
  } catch (err) {
    log('warn', 'feishu-bot', `download resource error: ${errText(err)}`)
    return null
  }
}
