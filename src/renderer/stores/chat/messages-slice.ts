// =============================================================
// 消息 slice — addMessage / clearMessages / loadHistory
// (消息生命周期与历史加载)
// =============================================================

import type { ChatMessage } from '@shared/types'
import { getAPI } from '../../lib/ipc-client'
import { pendingAgentOutputs } from './agent-pending'
import { flushStreamDeltas } from './delta-batch'
import { warnSaveFailed } from './persistence'
import type { ChatGet, ChatSet, ChatState } from './types'

export function createMessagesSlice(
  set: ChatSet,
  get: ChatGet,
): Pick<ChatState, 'addMessage' | 'clearMessages' | 'loadHistory'> {
  return {
    addMessage: (msg) => {
      set((s) => ({ messages: [...s.messages, msg] }))
      // Persist to DB (fire-and-forget)
      // 只立即保存 user 消息; assistant 消息在 text_end 事件中保存完整内容
      if (msg.role !== 'assistant') {
        getAPI()
          .chat.saveMessage({
            sessionId: get().sessionId,
            role: msg.role,
            content: msg.content,
            thinking: msg.thinking,
            timestamp: msg.timestamp,
          })
          .catch((err) => warnSaveFailed('user', err))
      }
    },

    clearMessages: () => {
      // F1 修复: 清空前 flush 待处理 delta(若缓冲属于被清会话,flush 后随清空一起消失)
      flushStreamDeltas()
      // C-3 修复: clearMessages 只清空当前显示,不删除会话数据
      // 之前调 chat.deleteSession(sid) 会把整个会话从 DB 删除,导致用户数据丢失
      // 用户若想删除会话,应使用侧边栏每个会话项右侧的 × 按钮(调 deleteSession)
      // L-10 配套: 同步清理 pending agent 缓存,避免切换会话后旧缓存残留导致内存泄漏
      pendingAgentOutputs.clear()
      set({ messages: [], lastUsage: null, lastCost: 0 })
    },

    loadHistory: async () => {
      if (get().historyLoaded) return
      // RISK 修复: 捕获当前 sessionId,await 后校验是否仍是当前 session
      // 之前用户快速切换 session 时,旧 loadHistory 的结果可能覆盖新 session 的消息
      const targetSessionId = get().sessionId
      try {
        const result = await getAPI().chat.loadMessages(targetSessionId)
        // 校验: await 期间 sessionId 可能已改变,若已切换则丢弃结果
        if (get().sessionId !== targetSessionId) return
        if (result.success && result.messages && result.messages.length > 0) {
          const loaded: ChatMessage[] = result.messages
            // HIGH 修复: 对 DB 返回的消息做运行时校验,避免类型断言掩盖数据损坏
            .filter(
              (m: Record<string, unknown>) =>
                typeof m?.role === 'string' &&
                typeof m?.content === 'string' &&
                typeof m?.timestamp === 'number',
            )
            .map((m: Record<string, unknown>) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content as string,
              thinking: typeof m.thinking === 'string' ? m.thinking : undefined,
              timestamp: m.timestamp as number,
            }))
            // H-1 配套: 过滤掉 createSession 写入的空 system 占位消息
            .filter((m) => !(m.role === 'system' && (!m.content || m.content.length === 0)))
          set({ messages: loaded, historyLoaded: true })
        } else {
          set({ historyLoaded: true })
        }
      } catch (err) {
        console.warn('[chatStore] loadHistory failed', err)
        // 错误时也校验 sessionId,避免错误状态覆盖新 session
        if (get().sessionId !== targetSessionId) return
        set({ historyLoaded: true })
      }
    },
  }
}
