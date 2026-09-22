// =============================================================
// Agent 事件收集器 — 输出/token/turn 计数聚合 + 渲染进程状态转发
// (M16 从 execution.ts 拆出,switch 逻辑与日志逐字保留;
//   计数从散落的 let 变量收敛为 stats 对象,可用 fake 事件流直接测聚合)
// =============================================================

import type { AgentEvent } from '@main/services/llm-contracts'
import type { BrowserWindow } from 'electron'
import { log } from '../../utils/logger'
import { createDeltaBatcher } from '../stream-batcher'
import { sendAgentStatus } from './status-tracking'

/** 工具结果 → 面向用户的短预览(截 200 字符;失败时错误文本优先) */
function toolResultPreview(result: unknown): string | undefined {
  try {
    const r = result as { content?: Array<{ type?: string; text?: string }>; error?: unknown }
    const text = r?.content?.find((c) => c.type === 'text')?.text
    if (typeof text === 'string' && text.length > 0) {
      return text.length > 200 ? `${text.slice(0, 200)}…` : text
    }
    if (r?.error !== undefined) {
      const errText = String(r.error)
      return errText.length > 200 ? `${errText.slice(0, 200)}…` : errText
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 工具调用 args → 渲染端预览。write_excel/read_excel 等工具会把整个数据集放进 args,
 * 不截断时单次 toolCall 事件就是数 MB 的 structured clone(主进程阻塞数十至数百 ms)。
 * 策略: 字符串值一律截 300 字符;数组只留前 8 项;对象只留前 40 个字段;深度 2 层封底。
 */
function argsPreview(args: unknown): unknown {
  const MAX_STR = 300
  const MAX_ARR = 8
  const MAX_KEYS = 40
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…(原长 ${v.length})` : v
    }
    if (Array.isArray(v)) {
      if (depth >= 2) return `…共 ${v.length} 项`
      const head = v.slice(0, MAX_ARR).map((x) => walk(x, depth + 1))
      return v.length > MAX_ARR ? [...head, `…共 ${v.length} 项`] : head
    }
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      if (depth >= 2) return `(对象,${entries.length} 个字段)`
      const out: Record<string, unknown> = {}
      for (const [k, val] of entries.slice(0, MAX_KEYS)) out[k] = walk(val, depth + 1)
      return entries.length > MAX_KEYS ? { ...out, '…': `共 ${entries.length} 个字段` } : out
    }
    return v
  }
  try {
    return walk(args, 0)
  } catch {
    return '(args 预览失败)'
  }
}

/** 单次运行的聚合统计(最终落库 tokenUsage/cost 与续跑判断都读这里) */
interface AgentRunStats {
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
 * 返回 flushPendingOutput — 调用方在发送最终状态前必须调用,清空未刷出的 delta。
 */
export function createEventCollector(
  win: BrowserWindow | undefined,
  id: string,
): {
  stats: AgentRunStats
  handler: (event: AgentEvent) => void
  flushPendingOutput: () => void
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

  // delta 攒批: text_delta 入缓冲按 33ms 窗口合并发送(逐条 send 的成本见 stream-batcher 注释);
  // 工具事件/turn 边界/最终状态前 flush,保证渲染端事件顺序不变
  const outputBatcher = createDeltaBatcher((merged) => {
    sendAgentStatus(win, id, 'running', { output: merged })
  })
  const flushPendingOutput = outputBatcher.flush

  const handler = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const aEvent = event.assistantMessageEvent
        if (aEvent && aEvent.type === 'text_delta') {
          stats.outputText += aEvent.delta
          outputBatcher.push(aEvent.delta)
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
        flushPendingOutput() // 保持事件顺序: 缓冲中的输出先于工具事件到达渲染端
        console.log(
          `[AgentService] agent(${id}) turn=${stats.turnCount} tool_start: ${event.toolName}`,
        )
        sendAgentStatus(win, id, 'running', {
          toolCall: { name: event.toolName, args: argsPreview(event.args) },
        })
        break
      case 'tool_execution_end':
        flushPendingOutput() // 同上: 工具结果前先补齐输出
        console.log(
          `[AgentService] agent(${id}) turn=${stats.turnCount} tool_end: ${event.toolName} error=${event.isError}`,
        )
        sendAgentStatus(win, id, 'running', {
          toolResult: {
            name: event.toolName,
            isError: event.isError,
            // R2+(工具可见性): 附带结果文本预览 — 此前只回传 isError,
            // 模型收到的错误详情(如"删除学生需要显式确认")用户完全看不到
            preview: toolResultPreview(event.result),
          },
        })
        break
      case 'turn_end': {
        stats.turnCount++
        flushPendingOutput() // turn 边界前把缓冲刷出
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
        flushPendingOutput()
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

  return { stats, handler, flushPendingOutput }
}
