// =============================================================
// feishu/messages — 发送文本消息(im/v1/messages)
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { errText } from '../../utils/err-text'
import type { FeishuDomain } from './config'
import { feishuApiRequest } from './request'

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
    const data = await feishuApiRequest<MessageResponse>({
      appId,
      appSecret,
      domain,
      path: '/im/v1/messages?receive_id_type=open_id',
      body: { receive_id: userOpenId, msg_type: 'text', content: JSON.stringify({ text }) },
    })
    return { success: true, messageId: data.data?.message_id }
  } catch (err) {
    return { success: false, error: errText(err) }
  }
}
