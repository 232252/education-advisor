// =============================================================
// dsh SessionEvent → AgentEvent（agent 执行链路的事件投影）
//
// createEventCollector 只消费 5 类事件：message_update(取
// assistantMessageEvent.type==='text_delta' 的 delta)、tool_execution_start、
// tool_execution_end、turn_end、agent_end。dsh 侧的对应来源：
//   assistant/message.stream  → message_update（压缩分片逐条展开）
//   tool/call                 → tool_execution_start
//   tool/result               → tool_execution_end
//   turn/end                  → agent_end（同时充当「本轮结束」信号，
//                                取代 pi 的 agent.waitForIdle()）
//
// AssistantMessageEvent 的每个变体都要求 contentIndex 与 partial，
// 因此这里必须持有一个随流增长的 partial AssistantMessage。
// =============================================================

import type {
  AgentEvent,
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
} from '@main/services/llm-contracts'
import type { TokenUsage } from '@shared/types/ai'
import { DSH_TURN_ABORTED, DSH_TURN_ERROR } from './stream-mapper'
import type { DshAssistantMessage, DshSessionEvent, DshTokenUsage } from './wire-types'

export interface DshAgentTurnInit {
  model: Model<Api>
  systemPrompt: string
  userPrompt: string
}

interface ProjectedTurn {
  /** 已投影出的 assistant 消息，供 agent_end 汇总 */
  messages: AssistantMessage[]
  /** dsh usage 无 cost，这里如实记 0 */
  usage: TokenUsage
  aborted: boolean
  failed: boolean
}

function toUsage(usage: DshTokenUsage | undefined): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // 模型给出的 arguments 未必是合法 JSON；保留原文，别把一次工具调用变成崩溃
    return raw
  }
}

/**
 * 有状态投影器：一次 agent 执行对应一个实例。
 * contentIndex 与 partial 必须随流递增，纯函数无法表达。
 */
export class DshAgentEventProjector {
  private contentIndex = 0
  private text = ''
  private readonly init: DshAgentTurnInit
  private readonly turn: ProjectedTurn = {
    messages: [],
    usage: zeroUsage(),
    aborted: false,
    failed: false,
  }

  constructor(init: DshAgentTurnInit) {
    this.init = init
  }

  /** 供 execution 侧收尾：等价于 pi Agent 跑完后的统计 */
  get result(): ProjectedTurn {
    return this.turn
  }

  private partial(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    const previous = this.turn.messages[this.turn.messages.length - 1]
    return {
      role: 'assistant',
      timestamp: Date.now(),
      content: this.text ? [{ type: 'text', text: this.text }] : [],
      api: this.init.model.api,
      provider: this.init.model.provider,
      model: this.init.model.id,
      usage: previous?.usage ?? emptyPiUsage(),
      stopReason: 'stop',
      ...overrides,
    }
  }

  private messageUpdate(delta: string): AgentEvent {
    const assistantMessageEvent: AssistantMessageEvent = {
      type: 'text_delta',
      contentIndex: this.contentIndex,
      delta,
      partial: this.partial(),
    }
    this.contentIndex += 1
    return {
      type: 'message_update',
      message: this.partial(),
      assistantMessageEvent,
    }
  }

  /** 一条 dsh SessionEvent → 0..n 个 AgentEvent */
  project(event: DshSessionEvent): AgentEvent[] {
    switch (event.type) {
      case 'assistant/message':
        return this.projectAssistantMessage(event.data)

      case 'tool/call': {
        const { callId, name, arguments: args } = event.data
        return [
          {
            type: 'tool_execution_start',
            toolCallId: callId,
            toolName: name,
            args: parseArgs(args),
          },
        ]
      }

      case 'tool/result': {
        const message = event.data.message
        if (!message) return []
        return [
          {
            type: 'tool_execution_end',
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            result: { content: message.content, details: message.details },
            isError: !!(event.data.error ?? message.isError),
          },
        ]
      }

      case 'turn/end': {
        const reason = event.data.reason
        if (reason === 'aborted') this.turn.aborted = true
        if (reason === 'error') this.turn.failed = true
        // turn_end 必须发：collector 的 stats.turnCount 由它累加，而
        // runContinuationLoop 用 turnCount 判断「模型是否过早收工」。
        // 漏掉它会让 dsh 路径每轮都被判为过早结束而反复续跑。
        return this.closingEvents()
      }

      default:
        return []
    }
  }

  private projectAssistantMessage(data: DshAssistantMessage): AgentEvent[] {
    const out: AgentEvent[] = []
    this.text = ''
    for (const record of data.stream ?? []) {
      if (record.type !== 'text-chunks') continue
      for (const chunk of record.texts) {
        this.text += chunk
        out.push(this.messageUpdate(chunk))
      }
    }
    const usage = toUsage(data.usage)
    this.turn.usage = {
      inputTokens: this.turn.usage.inputTokens + usage.inputTokens,
      outputTokens: this.turn.usage.outputTokens + usage.outputTokens,
      cacheReadTokens: this.turn.usage.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: this.turn.usage.cacheWriteTokens + usage.cacheWriteTokens,
    }
    // 归档本轮 assistant 消息（agent_end 与落库都取它）
    this.turn.messages.push(
      this.partial({
        content: this.text ? [{ type: 'text', text: this.text }] : [],
        stopReason: data.interrupted ? 'aborted' : 'stop',
      }),
    )
    return out
  }

  /**
   * 供调用方在流被外部错误打断时标记（此时不会再有 turn/end 可依）。
   * 与 markAbort 一样要回传收尾事件：pi 路径的每一轮都以 agent_end 结束。
   */
  markFailure(): AgentEvent[] {
    this.turn.failed = true
    return this.closingEvents()
  }

  /**
   * 外部打断（abort 会关掉子进程，因此不会再有 turn/end 可依）。
   * 必须与 pi 路径同形：既是 aborted（教师按的是「停止」而不是出错），
   * 也补齐 turn_end + agent_end —— 少了收尾，collector 的 turnCount 不累加、
   * execution 也等不到 agent_end。
   */
  markAbort(): AgentEvent[] {
    this.turn.aborted = true
    return this.closingEvents()
  }

  private closingEvents(): AgentEvent[] {
    const last = this.turn.messages[this.turn.messages.length - 1]
    return [
      { type: 'turn_end', message: last ?? this.partial(), toolResults: [] },
      // agent_end 是 collector 的收尾信号；aborted/error 也照常发出，
      // 由调用方读 result.aborted/failed 决定落库状态（与 pi 路径同结构）
      { type: 'agent_end', messages: this.turn.messages },
    ]
  }

  /** 供 execution 侧构造 pi 风格的错误事件文案（保持与 stream-mapper 同源） */
  static failureMessage(reason: 'aborted' | 'error'): string {
    return reason === 'aborted' ? DSH_TURN_ABORTED : DSH_TURN_ERROR
  }

  get conversation(): Message[] {
    return [
      { role: 'user', content: this.init.userPrompt, timestamp: Date.now() },
      ...this.turn.messages,
    ]
  }
}

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** AssistantMessage.usage 是 pi 的 Usage 形状（input/output/...），非 TokenUsage */
function emptyPiUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}
