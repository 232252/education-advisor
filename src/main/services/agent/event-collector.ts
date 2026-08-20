// =============================================================
// Agent 事件收集器 — 输出/token/turn 计数聚合 + 渲染进程状态转发
// (M16 从 execution.ts 拆出,switch 逻辑与日志逐字保留;
//   计数从散落的 let 变量收敛为 stats 对象,可用 fake 事件流直接测聚合)
// =============================================================

import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { BrowserWindow } from 'electron'
import { log } from '../../utils/logger'
import { sendAgentStatus } from './status-tracking'

/** 单次运行的聚合统计(最终落库 tokenUsage/cost 与续跑判断都读这里) */
export interface AgentRunStats {
  /** 流式输出的累计文本(text_delta 拼接) */
  outputText: string
  inputTokens: number
  outputTokens: number
  totalCost: number
  turnCount: number
  toolCallCount: number
  /** LLM 返回的最后一个错误(续跑判断 + 最终状态/用户提示;非 error turn 清除) */
  lastErrorMessage: string
}

/**
 * 创建事件收集器(闭包工厂):返回聚合 stats + 可直接传给 agent.subscribe 的 handler。
 * handler 转发 running 状态到渲染进程,并把诊断事件走 logger(debug 级别)。
 */
export function createEventCollector(
  win: BrowserWindow,
  id: string,
): {
  stats: AgentRunStats
  handler: (event: AgentEvent) => void
} {
  const stats: AgentRunStats = {
    outputText: '',
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    turnCount: 0,
    toolCallCount: 0,
    lastErrorMessage: '',
  }

  const handler = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const aEvent = event.assistantMessageEvent
        if (aEvent && aEvent.type === 'text_delta') {
          stats.outputText += aEvent.delta
          sendAgentStatus(win, id, 'running', { output: aEvent.delta })
        }
        // 诊断: 记录非 text_delta 的 message_update 事件类型(走 logger,debug 级别)
        if (aEvent && aEvent.type !== 'text_delta') {
          try {
            log(
              'debug',
              'agent',
              `MSG_UPDATE: type=${aEvent.type} keys=${Object.keys(aEvent).join(',')}`,
            )
          } catch {
            // ignore
          }
        }
        break
      }
      case 'tool_execution_start':
        stats.toolCallCount++
        console.log(
          `[AgentService] agent(${id}) turn=${stats.turnCount} tool_start: ${event.toolName}`,
        )
        sendAgentStatus(win, id, 'running', {
          toolCall: { name: event.toolName, args: event.args },
        })
        break
      case 'tool_execution_end':
        console.log(
          `[AgentService] agent(${id}) turn=${stats.turnCount} tool_end: ${event.toolName} error=${event.isError}`,
        )
        sendAgentStatus(win, id, 'running', {
          toolResult: { name: event.toolName, isError: event.isError },
        })
        break
      case 'turn_end': {
        stats.turnCount++
        const msg = event.message as {
          stopReason?: string
          errorMessage?: string
          content?: Array<{ type?: string; text?: string }>
        }
        const tcInTurn = Array.isArray(msg?.content)
          ? msg.content.filter((c) => c.type === 'toolCall').length
          : 0
        console.log(
          `[AgentService] agent(${id}) turn ${stats.turnCount} ended: stopReason=${msg?.stopReason ?? '?'} tools=${tcInTurn} outputLen=${stats.outputText.length} errorMessage=${msg?.errorMessage ?? 'none'}`,
        )
        // 捕获/清除 LLM 错误信息(用于续跑判断 + 最终状态/用户提示)
        // 修复: 非 error 的 turn 要清除旧错误,避免 stale error 导致 false-positive hasError
        if (msg?.stopReason === 'error' && msg.errorMessage) {
          stats.lastErrorMessage = msg.errorMessage
        } else if (msg?.stopReason && msg.stopReason !== 'error') {
          stats.lastErrorMessage = ''
        }
        // 诊断: 记录完整 turn_end 详情(含 errorMessage,用于定位 stopReason=error)。走 logger debug 级别
        try {
          const contentSummary = Array.isArray(msg?.content)
            ? msg.content.map((c) => ({ type: c.type, textPreview: c.text?.slice(0, 200) }))
            : 'no content array'
          log(
            'debug',
            'agent',
            `TURN_END: stopReason=${msg?.stopReason ?? '?'} tools=${tcInTurn} outputLen=${stats.outputText.length} errorMessage=${msg?.errorMessage ?? 'none'} content=${JSON.stringify(contentSummary)}`,
          )
        } catch {
          // ignore
        }
        break
      }
      case 'agent_end': {
        const messages = event.messages
        for (const msg of messages) {
          if (msg && msg.role === 'assistant' && 'usage' in msg) {
            const u = (
              msg as { usage?: { input?: number; output?: number; cost?: { total?: number } } }
            ).usage
            if (u) {
              stats.inputTokens += u.input ?? 0
              stats.outputTokens += u.output ?? 0
              if (u.cost) {
                stats.totalCost += u.cost.total ?? 0
              }
            }
          }
        }
        break
      }
    }
  }

  return { stats, handler }
}
