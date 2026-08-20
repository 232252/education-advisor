// =============================================================
// feishu-bot/message-handler — 单条飞书消息的处理流程
// 从 feishu-bot-service.ts 的 handleMessage 下沉(纯重构,行为不变):
// 解析/安全过滤(message-parsing) → 斜杠命令分发 → 默认 Agent 对话 → 按消息 ID 回复。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import { log } from '../../utils/logger'
import type { CommandContext, FeishuCommandRouter } from './command-router'
import { parseIncomingMessage } from './message-parsing'
import { sendReply } from './reply'
import type { FeishuMessageEvent } from './types'

/** 消息处理流程所需依赖(由 facade 注入,保持本模块无状态) */
export interface MessageHandlerDeps {
  /** 斜杠命令路由器 */
  router: FeishuCommandRouter
  /** 动态获取当前 SDK Client(stop/重启时会被置 null,不能提前捕获) */
  getSdkClient: () => lark.Client | null
  /** 处理中计数 +1(诊断并发用) */
  onProcessingStart: () => void
  /** 处理中计数 -1 */
  onProcessingEnd: () => void
}

/**
 * 处理一条收到的飞书消息(解析/安全过滤在 feishu-bot/message-parsing)。
 * 先尝试斜杠命令;非命令转默认 Agent 对话,完成后回复。
 */
export async function handleIncomingMessage(
  deps: MessageHandlerDeps,
  data: FeishuMessageEvent,
  ctx: CommandContext,
): Promise<void> {
  const parsed = parseIncomingMessage(data)
  if (!parsed) return
  const { text, messageId, chatType } = parsed

  deps.onProcessingStart()
  log('info', 'feishu-bot', `recv [${chatType}] "${text.slice(0, 50)}"`)

  try {
    // 先尝试斜杠命令;非命令转 Agent 对话
    let reply: string | null
    try {
      reply = await deps.router.dispatch(text, ctx)
    } catch (err) {
      reply = `命令处理出错: ${err instanceof Error ? err.message : String(err)}`
    }

    if (reply === null) {
      // 普通对话 → 默认 Agent
      reply = await ctx.runAgent(text)
    }

    if (reply && messageId) {
      await sendReply(deps.getSdkClient(), messageId, reply)
    }
  } finally {
    deps.onProcessingEnd()
  }
}
