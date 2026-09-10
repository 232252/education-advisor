// =============================================================
// AI 流式对话 handler — 发起(逐事件推送到渲染进程,附 sessionId 路由)
// 隐私接线: settings.privacy.autoAnonymize 开启时,出域消息(含 systemPrompt)
// 先真名→化名,text_delta 增量经 carry 过滤器化名→真名后推给渲染进程 —
// 成绩录入(学生名单内嵌 systemPrompt)与家校话术等直连功能的明文姓名
// 从此不再出域;隐私引擎未解锁时直接报错(fail-closed,与 Agent 链路一致)。
// =============================================================

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import * as IPC from '@shared/ipc-channels'
import type { StreamEvent } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { sendToRenderer } from '../broadcast'
import { handleIpc } from '../handle'
import { isAutoAnonymizeEnabled, PrivacyGuard } from '../../services/agent/privacy-guard'
import { piAIService } from '../../services/pi-ai-service'
import { createDeltaBatcher } from '../../services/stream-batcher'
import { errText } from '../../utils/err-text'
import { chatState } from './state'

export function registerAIChatHandlers(win: BrowserWindow): void {
  // ----- 流式对话 -----
  // 前端调用 ai:chat 后，主进程通过 ai:chat-stream 逐事件推送
  handleIpc(
    IPC.IPC_AI_CHAT,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        messages: Array<{ role: string; content: string }>
        systemPrompt?: string
        thinking?: string
        maxTokens?: number
      },
    ) => {
      // 异步执行流式对话，逐事件推送到渲染进程
      // P1-41 修复:跟踪会话状态,主动捕获 IIFE 异常,确保错误始终送到前端
      chatState.activeChatCount++
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // F1 修复: 每个流事件附加 sessionId,渲染端按 sessionId 过滤本请求的事件,
      // 避免全窗口广播把无关 delta 串扰给其他订阅者(如 Chat 页 Agent 流)
      const sendToChat = (event: StreamEvent) => {
        sendToRenderer(win, IPC.IPC_AI_CHAT_STREAM, { ...event, sessionId })
      }

      // 隐私守卫(可选): 出域 anonymize / 回域流式 deanonymize
      let privacyGuard: PrivacyGuard | undefined
      if (isAutoAnonymizeEnabled()) {
        try {
          privacyGuard = await PrivacyGuard.create()
        } catch (err) {
          chatState.activeChatCount = Math.max(0, chatState.activeChatCount - 1)
          const message = errText(err)
          sendToChat({
            type: 'error',
            message: `隐私脱敏初始化失败: ${message}`,
            retryable: false,
          })
          return { success: true, message: 'Stream started', sessionId }
        }
      }

      ;(async () => {
        try {
          // P1-42 修复:thinking 通过 ModelThinkingLevel 类型安全转换
          // 6 个枚举值: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
          const thinking = params.thinking as ModelThinkingLevel | undefined

          const stream = piAIService.chatStream({
            providerId: params.providerId,
            modelId: params.modelId,
            messages: privacyGuard
              ? params.messages.map((m) => ({ ...m, content: privacyGuard.anonymize(m.content) }))
              : params.messages,
            systemPrompt:
              privacyGuard && params.systemPrompt
                ? privacyGuard.anonymize(params.systemPrompt)
                : params.systemPrompt,
            thinking,
            maxTokens: params.maxTokens,
          })

          const deanon = privacyGuard?.createStreamDeanonymizer()
          let sawDone = false
          // text_delta 攒批推送(33ms 窗口,见 services/stream-batcher.ts) —
          // 此前对每个 SSE chunk 单独 send,长回复的 IPC send 是千级
          const deltaBatcher = createDeltaBatcher((merged) => {
            sendToChat({ type: 'text_delta', delta: merged })
          })
          for await (const event of stream) {
            if (deanon && event.type === 'text_delta') {
              const restored = deanon.push(event.delta)
              if (restored) {
                deltaBatcher.push(restored)
              }
              if (event.type === 'text_delta') continue
            }
            if (event.type === 'done') {
              // done 前释放 carry 中扣住的尾部字符,保证渲染端拿到完整真名文本
              sawDone = true
              if (deanon) {
                const rest = deanon.flush()
                if (rest) deltaBatcher.push(rest)
              }
              deltaBatcher.flush() // done 前补齐缓冲,保持事件顺序
            }
            sendToChat(event)
          }
          if (deanon && !sawDone) {
            const rest = deanon.flush()
            if (rest) deltaBatcher.push(rest)
          }
          deltaBatcher.flush() // 流结束补尾,防最后窗口内的文本丢失
        } catch (err: unknown) {
          sendToChat({
            type: 'error',
            message: errText(err),
            retryable: false,
          })
        } finally {
          chatState.activeChatCount = Math.max(0, chatState.activeChatCount - 1)
          console.log(`[AI] Chat session ${sessionId} ended (active: ${chatState.activeChatCount})`)
        }
      })()

      return { success: true, message: 'Stream started', sessionId }
    },
  )
}
