// =============================================================
// feishu/messages — 发送文本消息(im/v1/messages)
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { FEISHU_FETCH_TIMEOUT_MS, type FeishuDomain, getApiBase } from './config'
import { getTenantToken } from './token'

interface MessageResponse {
  code: number
  msg: string
  data?: { message_id?: string }
}

/** 给 userOpenId 发文本消息 */
export async function sendTextMessage(
  appId: string,
  appSecret: string,
  userOpenId: string,
  text: string,
  domain: FeishuDomain,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { token } = await getTenantToken(appId, appSecret, domain)
    const apiBase = getApiBase(domain)
    const res = await fetch(`${apiBase}/im/v1/messages?receive_id_type=open_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: userOpenId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as MessageResponse
    if (data.code !== 0) {
      return { success: false, error: `code=${data.code} msg=${data.msg}` }
    }
    return { success: true, messageId: data.data?.message_id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
