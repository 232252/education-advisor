// =============================================================
// Agent 桥接 slice — handleAgentEvent / setSelectedAgent
// (把 AgentStatusUpdate 映射到 chat 消息)
// =============================================================

import { formatLlmError } from '@shared/llm-error'
import type { TokenUsage } from '@shared/types'
import { t } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../toastStore'
import { MAX_PENDING_AGENTS, pendingAgentOutputs } from './agent-pending'
import { warnSaveFailed } from './persistence'
import type { ChatGet, ChatSet, ChatState } from './types'

/**
 * 会话自动起名 — 默认标题(新对话/对话 + 时间戳)时用首条用户消息前 20 字派生。
 * idle 与 error 终止时都调用: 首轮就报错的会话此前永远保持默认标题(2026-08-28 智能轮核查补角)。
 */
function autoNameSessionIfDefault(get: ChatGet, set: ChatSet) {
  const sess = get().sessions.find((x) => x.id === get().sessionId)
  if (!sess || !/^(新对话|对话)/.test(sess.title)) return
  const firstUser = get().messages.find((m) => m.role === 'user')
  const derived = firstUser?.content.trim().slice(0, 20)
  if (!derived) return
  const title = derived.replace(/\s+/g, ' ')
  set((st) => ({ sessions: st.sessions.map((x) => (x.id === sess.id ? { ...x, title } : x)) }))
  getAPI()
    .chat.renameSession(sess.id, title)
    .catch(() => {
      /* 起名失败不影响会话 */
    })
}

export function createAgentBridgeSlice(
  set: ChatSet,
  get: ChatGet,
): Pick<ChatState, 'handleAgentEvent' | 'setSelectedAgent'> {
  return {
    // High 3.2 修复: 切 agent 时主动清理 isStreaming/isThinking,
    // 避免旧 agent 的 running 事件把 isStreaming 置 true 后切换到新 agent 时卡死
    // R-1 修复: 不重置 streamingAgentId,以便切回原 agent 时能检测到"未完成的流"并复用
    // 最后一条 assistant 消息,避免重复创建消息气泡。
    // isStreaming 仍需重置以保证切到新 agent 时 UI 不显示 streaming 状态。
    setSelectedAgent: (id) =>
      set({
        selectedAgentId: id,
        isStreaming: false,
        isThinking: false,
      }),

    // === Agent 事件桥接 — 把 AgentStatusUpdate 映射到 chat 消息 ===
    handleAgentEvent: (data) => {
      const state = get()
      // High 3.2 修复: 切 agent 时旧 agent 的 idle/error 被过滤导致 isStreaming 卡死
      // 之前直接 return,旧 agent 的 idle/error 事件被丢弃,isStreaming 永远不会重置
      // 修复策略 v1: 对于 idle/error 终止事件,即使 agentId 不匹配也要清理可能残留的 isStreaming 状态
      // 修复策略 v2(避免 v1 引入的回归): 只有当 idle/error 来自 streamingAgentId 时才清理,
      //   避免旧 agent 的 idle 事件错误清理新 agent 的流状态
      // 串台修复: 流启动后用户切换了会话 → 该流的任何事件不再写入当前(新)会话。
      // idle/error 仅做流状态清理;部分输出已由 switchSession 落到旧会话。
      if (state.streamSessionId && state.streamSessionId !== state.sessionId) {
        if (data.status === 'idle' || data.status === 'error') {
          set({
            isStreaming: false,
            isThinking: false,
            streamingAgentId: null,
            streamSessionId: null,
          })
        }
        return
      }

      if (data.agentId !== state.selectedAgentId) {
        // CONCERN 修复: 缓存切走期间的 output,切回时合并到消息
        if (data.status === 'running' && data.output) {
          const buf = pendingAgentOutputs.get(data.agentId) ?? []
          buf.push(data.output)
          pendingAgentOutputs.set(data.agentId, buf)
          // L-10 修复: 限制最大缓存条目数,删除最旧的条目
          if (pendingAgentOutputs.size > MAX_PENDING_AGENTS) {
            const firstKey = pendingAgentOutputs.keys().next().value
            if (firstKey) pendingAgentOutputs.delete(firstKey)
          }
        }
        // R-1 修复: 移除 isStreaming 条件 — 即使 isStreaming 已被 setSelectedAgent 重置为 false,
        // 终止事件(idle/error)仍需清理 streamingAgentId,否则后续同 agent 的新流会误判为"复用"
        if (
          (data.status === 'idle' || data.status === 'error') &&
          state.streamingAgentId === data.agentId
        ) {
          // 终止事件:清理缓存,重置流状态
          pendingAgentOutputs.delete(data.agentId)
          set({ isStreaming: false, isThinking: false, streamingAgentId: null })
        }
        return
      }

      switch (data.status) {
        case 'running': {
          // R2+: 上下文压缩已发生 → 用户可见提示(此前只有 console.log,表现为 AI 突然失忆)
          if (data.compacted) {
            toast.info(
              t('page.chat.compactedNotice', '对话过长,已自动压缩较早的历史(完整记录仍在数据库)'),
            )
          }
          // 第一次收到 running 且未在 streaming → 初始化或复用 assistant 消息
          if (!state.isStreaming) {
            // R-1 修复: 检测"切回原 agent"场景 — 若 streamingAgentId 仍指向当前 agent,
            // 说明流未被 idle/error 终止(用户只是切走又切回),复用最后一条 assistant 消息,
            // 避免重复创建消息气泡。
            const lastMsg = state.messages[state.messages.length - 1]
            if (state.streamingAgentId === data.agentId && lastMsg?.role === 'assistant') {
              // 复用:仅恢复 isStreaming,不新建消息
              set({ isStreaming: true, isThinking: false, streamSessionId: state.sessionId })
              // CONCERN 修复: 合并切走期间缓存的 output,避免文本截断
              const pending = pendingAgentOutputs.get(data.agentId)
              if (pending && pending.length > 0) {
                const combined = pending.join('')
                pendingAgentOutputs.delete(data.agentId)
                state.appendStreamDelta(combined)
              }
            } else {
              // 新流:记录 streamingAgentId + 新建 assistant 消息
              set({
                isStreaming: true,
                isThinking: false,
                streamingAgentId: data.agentId,
                streamSessionId: state.sessionId,
              })
              // LOW 修复: 清理非当前 agent 的残留缓存,防止 agent 崩溃(不发出 idle/error)
              // 导致 pendingAgentOutputs 内存泄漏。新流开始意味着用户关注当前 agent,
              // 之前切走期间的其他 agent 缓存已无意义(切回也会从新流开始)。
              for (const key of pendingAgentOutputs.keys()) {
                if (key !== data.agentId) pendingAgentOutputs.delete(key)
              }
              state.addMessage({
                role: 'assistant',
                content: '',
                toolCalls: [],
                timestamp: Date.now(),
              })
            }
          }
          // 追加文本输出
          if (data.output) {
            state.appendStreamDelta(data.output)
          }
          // 追加工具调用
          if (data.toolCall) {
            const toolCall = data.toolCall
            set((s) => {
              const msgs = [...s.messages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'assistant') {
                msgs[msgs.length - 1] = {
                  ...last,
                  toolCalls: [
                    ...(last.toolCalls || []),
                    {
                      id: `tc_${Date.now()}`,
                      name: toolCall.name,
                      args: (toolCall.args as Record<string, unknown>) || {},
                    },
                  ],
                }
              }
              return { messages: msgs }
            })
          }
          // 工具结果 — 更新最后一个同名工具的 result
          if (data.toolResult) {
            const toolResult = data.toolResult
            set((s) => {
              const msgs = [...s.messages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'assistant' && last.toolCalls) {
                const tcs = [...last.toolCalls]
                // 从后往前找最后一个匹配名称的工具调用
                for (let i = tcs.length - 1; i >= 0; i--) {
                  if (tcs[i].name === toolResult.name && !tcs[i].result) {
                    tcs[i] = {
                      ...tcs[i],
                      // 优先展示结果文本预览(工具可见性),无预览时退回状态标记
                      result: toolResult.preview ?? (toolResult.isError ? 'error' : 'success'),
                      isError: toolResult.isError,
                    }
                    break
                  }
                }
                msgs[msgs.length - 1] = { ...last, toolCalls: tcs }
              }
              return { messages: msgs }
            })
          }
          break
        }

        case 'idle': {
          // Agent 执行完成 — 保存消息并结束 streaming
          const msgs = get().messages
          const lastMsg = msgs[msgs.length - 1]
          // 空内容守卫(2026-08-28 智能轮核查): abort 后零输出的空气泡不落库,
          // 否则重开会话会加载出一条空气泡(与 switchSession 部分落库的守卫同口径)
          if (lastMsg?.role === 'assistant' && lastMsg.content.trim().length > 0) {
            getAPI()
              .chat.saveMessage({
                sessionId: get().sessionId,
                role: 'assistant',
                content: lastMsg.content,
                thinking: lastMsg.thinking,
                timestamp: lastMsg.timestamp,
                provider: `agent:${data.agentId}`,
                model: data.agentId,
              })
              .catch((err) => warnSaveFailed('agent', err))
          }
          // R2+: 会话自动起名 — 默认标题时用首条用户消息派生(error 轮也起名,见 helper)
          autoNameSessionIfDefault(get, set)
          const usage: TokenUsage = data.result?.tokenUsage || {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          }
          set({
            isStreaming: false,
            isThinking: false,
            streamingAgentId: null,
            streamSessionId: null,
            lastUsage: usage,
            lastCost: data.result?.cost || 0,
            lastModel: data.result?.model ?? '',
          })
          break
        }

        case 'error': {
          // H-6 修复: 错误分支需要检查最后消息角色
          // 之前只在 !state.isStreaming 时创建 assistant 消息,
          // 但如果 streaming 已开始且最后消息不是 assistant(如用户在运行中发了新消息),
          // appendStreamDelta 会静默失败,错误信息丢失
          if (data.error) {
            const msgs = get().messages
            const lastMsg = msgs[msgs.length - 1]
            if (!state.isStreaming || !lastMsg || lastMsg.role !== 'assistant') {
              // streaming 未开始,或最后消息不是 assistant → 新建一条承载错误
              // 注意: 不必先 set isStreaming:true,因为 addMessage 不依赖它,
              // 且紧随其后会把 isStreaming 置 false,避免 UI 出现一帧的"加载中"闪烁。
              state.addMessage({
                role: 'assistant',
                content: `**错误:** ${formatLlmError(data.error)}`,
                timestamp: Date.now(),
              })
            } else {
              // 最后消息是 assistant → 追加错误信息
              get().appendStreamDelta(`\n\n**错误:** ${formatLlmError(data.error)}`)
            }
          }
          set({
            isStreaming: false,
            isThinking: false,
            streamingAgentId: null,
            streamSessionId: null,
          })
          // 首轮即报错的会话也自动起名(此前只有 idle 分支起名,error 轮漏掉)
          autoNameSessionIfDefault(get, set)
          break
        }
      }
    },
  }
}
