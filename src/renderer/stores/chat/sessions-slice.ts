// =============================================================
// 会话 slice — createSession / switchSession / deleteSession / loadSessions
// =============================================================

import { t } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import { pendingAgentOutputs } from './agent-pending'
import { flushStreamDeltas } from './delta-batch'
import { sessionViewReset } from './state-reset'
import type { ChatGet, ChatSession, ChatSet, ChatState } from './types'

/** 竞态修复: loadSessions 请求令牌，防止快速切换时旧响应覆盖新数据 */
let loadSessionsReqId = 0

export function createSessionsSlice(
  set: ChatSet,
  get: ChatGet,
): Pick<ChatState, 'createSession' | 'switchSession' | 'deleteSession' | 'loadSessions'> {
  return {
    // === Session Management ===

    createSession: (title?: string) => {
      // RISK 修复: 加入随机后缀,避免 deleteSession 后立即 createSession
      // 生成相同 id(同毫秒 Date.now() 相同),导致旧 session id 复用,
      // 表现为 "deleteSession 后 session 仍在列表里"
      const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const newSession: ChatSession = {
        id,
        title: title || `新对话 ${new Date().toLocaleTimeString()}`,
        createdAt: Date.now(),
        messageCount: 0,
      }
      set((s) => ({
        sessions: [newSession, ...s.sessions],
        ...sessionViewReset(id),
      }))
      // L-10 配套: 新建会话时清理 pending agent 缓存,避免旧会话的残留缓存污染新会话
      pendingAgentOutputs.clear()
      // H-1 修复: 持久化空会话到 DB,避免用户创建会话后未发消息就刷新导致会话丢失
      // 通过写入一条 system 角色的占位消息触发 syncSessionMeta 创建 session 记录
      // loadHistory 时会加载这条消息,但因 role='system' 且 content 为空,UI 不渲染
      getAPI()
        .chat.saveMessage({
          sessionId: id,
          role: 'system',
          content: '',
          timestamp: Date.now(),
        })
        .catch((err) => {
          // 修复: 提升为 error 级别并通知用户,会话未落盘刷新后会丢失
          console.error('[chatStore] createSession persist failed', err)
          toast.error('会话创建未能保存,刷新后可能丢失')
        })
    },

    switchSession: (id: string) => {
      if (get().sessionId === id) return
      // F1 修复: 切换会话前 flush 待处理 delta,
      // 否则模块级 50ms 缓冲中的 pending delta 会写入新会话的末条 assistant 消息
      flushStreamDeltas()
      // 串台修复(2026-08-28 审计): 在途流必须先终止 — 否则 abort 前后的
      // delta/idle 事件会写入新会话并在新会话 id 下落库。
      const state = get()
      if (state.isStreaming && state.selectedAgentId) {
        // 部分输出属于旧会话,先落库再走(与 Chat 停止按钮的行为一致)
        const msgs = state.messages
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && last.content.trim().length > 0) {
          getAPI()
            .chat.saveMessage({
              sessionId: state.sessionId,
              role: 'assistant',
              content: last.content,
              thinking: last.thinking,
              timestamp: last.timestamp,
              provider: `agent:${state.selectedAgentId}`,
              model: state.selectedAgentId,
            })
            .catch(() => {
              /* 保存失败不阻断切换 */
            })
        }
        try {
          getAPI().agent.abort(state.selectedAgentId)
        } catch {
          /* abort 失败不阻断切换;晚到的流事件由 streamSessionId 守卫丢弃 */
        }
        // 注意: streamSessionId 保留指向旧会话 — 若一并清空,守卫(依赖
        // streamSessionId ≠ sessionId)永不命中,abort 生效前已入队的晚到
        // running 事件会在新会话新建气泡串台。isStreaming/streamingAgentId
        // 仍需复位,保证新会话 UI 不显示流式状态。
        set({
          isStreaming: false,
          isThinking: false,
          streamingAgentId: null,
          streamSessionId: state.sessionId,
        })
      }
      // P2-7: 排队消息属于旧会话的对话流,切换会话即作废(避免串到新会话开头)
      set({ queuedInputs: [] })
      set(sessionViewReset(id))
      // 加载该会话的历史消息
      get().loadHistory()
    },

    deleteSession: (id: string) => {
      const state = get()
      // 从列表中移除
      set((s) => ({
        sessions: s.sessions.filter((ses) => ses.id !== id),
      }))
      // 如果删除的是当前会话，切换到第一个可用会话或创建新会话
      if (state.sessionId === id) {
        const remaining = get().sessions
        if (remaining.length > 0) {
          get().switchSession(remaining[0].id)
        } else {
          get().createSession()
        }
      }
      // 异步清理持久化数据
      getAPI()
        .chat.deleteSession(id)
        .catch((err) => {
          console.warn('[chatStore] deleteSession failed', err)
          toast.error(t('toast.chat.sessionDeleteFailed', '删除会话失败,请查看日志'))
        })
    },

    loadSessions: async () => {
      const reqId = ++loadSessionsReqId
      try {
        const result = await getAPI().chat.listSessions()
        // 竞态保护: 快速切换会话时旧请求返回后不覆盖新数据
        if (reqId !== loadSessionsReqId) return
        if (result.success && result.sessions) {
          const dbSessions: ChatSession[] = result.sessions
            // HIGH 修复: 对 DB 返回的 session 做运行时校验,避免非法记录污染 sessions 数组
            .filter(
              (s: Record<string, unknown>) =>
                typeof s?.id === 'string' &&
                typeof s?.title === 'string' &&
                typeof s?.createdAt === 'number',
            )
            .map((s: Record<string, unknown>) => ({
              id: s.id as string,
              title: s.title as string,
              createdAt: s.createdAt as number,
              messageCount: typeof s.messageCount === 'number' ? s.messageCount : 0,
            }))
          // H-2 修复: 不直接覆盖 sessions,而是合并 DB sessions 和本地 sessions
          // 保留本地存在但 DB 不存在的会话(如刚 createSession 但 saveMessage 还在 flight)
          const localSessions = get().sessions
          const dbIds = new Set(dbSessions.map((s) => s.id))
          const localOnly = localSessions.filter((s) => !dbIds.has(s.id))
          const merged = [...dbSessions, ...localOnly]
          if (reqId !== loadSessionsReqId) return
          set({ sessions: merged })
          // 如果没有会话，自动创建一个
          if (merged.length === 0) {
            get().createSession()
          }
        }
      } catch (err) {
        if (reqId !== loadSessionsReqId) return
        console.warn('[chatStore] loadSessions failed', err)
      }
    },
  }
}
