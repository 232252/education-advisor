// =============================================================
// Compaction Helper - 桥接 SDK 压缩能力到 Agent/Chat 链路
//
// 设计要点:
//   - Agent 链路:通过 Agent 构造时的 transformContext 钩子触发
//   - Chat 链路:由 pi-ai-service.chatStream 直接调用 compactMessages
//   - 复用 SDK 三个工具函数: shouldCompact / estimateContextTokens / generateSummary
//   - 当 messages 总量超过 (contextWindow - reserveTokens) 时触发 LLM 摘要
//   - 摘要文本作为一条 user 消息插入,保留最近 keepRecentTokens 部分原样
// =============================================================

import type { AgentMessage, CompactionSettings } from '@earendil-works/pi-agent-core'
import { estimateContextTokens, generateSummary } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { completeSimple, getEnvApiKey } from '@earendil-works/pi-ai'

/**
 * 压缩阈值结果
 */
export interface CompactionDecision {
  /** 是否需要压缩 */
  shouldCompact: boolean
  /** 估算的 token 数 */
  contextTokens: number
  /** 阈值 (contextWindow - reserveTokens) */
  threshold: number
}

/**
 * 评估当前消息列表是否需要压缩
 * - 优先用 SDK 的 token 估算(基于 provider usage 数据,可能为 0)
 * - 兜底:用消息字符总数除以 4(SDK 默认字符/token 比例)作为估算
 * - 触发阈值:估算 token > (contextWindow - reserveTokens) 即 contextWindow 的 90%
 */
export function evaluateCompaction(
  messages: AgentMessage[],
  model: Model<Api>,
  settings: CompactionSettings,
): CompactionDecision {
  const { tokens: sdkTokens } = estimateContextTokens(messages)
  // 兜底估算: 字符总数 / 4 (1 token ≈ 4 字符, 跟 SDK 内部策略一致)
  let charEstimate = 0
  for (const m of messages) {
    const content = (m as { content?: unknown }).content
    if (typeof content === 'string') charEstimate += content.length
    else if (Array.isArray(content)) {
      for (const b of content) {
        const r = b as {
          type?: string
          text?: string
          thinking?: string
          name?: string
          arguments?: unknown
        }
        if (r.type === 'text' && r.text) charEstimate += r.text.length
        else if (r.type === 'thinking' && r.thinking) charEstimate += r.thinking.length
        else if (r.type === 'image') charEstimate += 4800
        else if (r.type === 'toolCall')
          charEstimate += (r.name?.length ?? 0) + JSON.stringify(r.arguments ?? {}).length
      }
    } else if (typeof content === 'object' && content !== null) {
      try {
        charEstimate += JSON.stringify(content).length
      } catch {
        /* ignore */
      }
    }
  }
  const charTokens = Math.ceil(charEstimate / 4)
  // 取较大值(SDK 估算在没 usage 时是 0,必须用 char 兜底)
  const tokens = Math.max(sdkTokens, charTokens)
  const threshold = model.contextWindow - settings.reserveTokens
  return {
    shouldCompact: settings.enabled && tokens > threshold,
    contextTokens: tokens,
    threshold,
  }
}

/**
 * 对 messages 进行压缩:
 *  1. 找到 splitIndex(从尾部向前,累计 token 不超过 keepRecentTokens)
 *  2. 对 splitIndex 之前的消息调 LLM 生成结构化摘要
 *  3. 返回 [summaryMessage, ...recentMessages]
 *
 * 失败时(API 错误/超时)返回原始 messages,保证不破坏 Agent 运行
 */
export async function compactAgentMessages(
  messages: AgentMessage[],
  model: Model<Api>,
  settings: CompactionSettings,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AgentMessage[]> {
  if (messages.length <= 2) return messages

  const decision = evaluateCompaction(messages, model, settings)
  if (!decision.shouldCompact) return messages

  console.log(
    `[Compaction] Triggered: ${decision.contextTokens} tokens > ${decision.threshold} threshold ` +
      `(window=${model.contextWindow}, reserve=${settings.reserveTokens}, keepRecent=${settings.keepRecentTokens})`,
  )

  // 找到 splitIndex:从尾部向前累计 token,达到 keepRecentTokens 时停止
  let recentTokens = 0
  let splitIndex = messages.length
  // 简化版 estimateTokens (与 SDK 内部策略一致:字符数 / 4)
  // 注意:AgentMessage 是联合类型,部分成员(如 BashExecutionMessage)没有 content 字段,
  // 这里用宽松收窄,只处理有 content 字段的成员
  const estimateOne = (m: AgentMessage): number => {
    const content = (m as { content?: unknown }).content
    let chars = 0
    if (typeof content === 'string') {
      chars = content.length
    } else if (Array.isArray(content)) {
      for (const raw of content) {
        const b = raw as {
          type?: string
          text?: string
          thinking?: string
          name?: string
          arguments?: unknown
        }
        if (b.type === 'text' && b.text) chars += b.text.length
        else if (b.type === 'thinking' && b.thinking) chars += b.thinking.length
        else if (b.type === 'image') chars += 4800
        else if (b.type === 'toolCall')
          chars += (b.name?.length ?? 0) + JSON.stringify(b.arguments ?? {}).length
      }
    } else if (typeof content === 'object' && content !== null) {
      // bashExecution 等其他类型:粗略统计其序列化长度
      try {
        chars = JSON.stringify(content).length
      } catch {
        chars = 0
      }
    }
    return Math.ceil(chars / 4)
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateOne(messages[i])
    if (recentTokens + t > settings.keepRecentTokens) break
    recentTokens += t
    splitIndex = i
  }

  // 至少保留最后 1 条
  if (splitIndex >= messages.length) splitIndex = messages.length - 1

  const oldMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  if (oldMessages.length === 0) return messages

  // 调用 SDK generateSummary
  const result = await generateSummary(
    oldMessages,
    model,
    settings.reserveTokens,
    apiKey,
    undefined,
    signal,
    undefined,
    undefined,
    undefined,
  )

  if (!result.ok) {
    console.warn(`[Compaction] Summary generation failed: ${result.error.message}, skipping`)
    return messages
  }

  const summaryText = result.value
  console.log(
    `[Compaction] Generated ${summaryText.length} chars summary for ${oldMessages.length} old messages, ` +
      `kept ${recentMessages.length} recent messages (${recentTokens} tokens)`,
  )

  // 构造 summary 作为 user 消息(自定义类型 compactionSummary)
  const summaryMessage: AgentMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[对话历史压缩] 之前 ${oldMessages.length} 条消息已被压缩为以下摘要:\n\n${summaryText}`,
      },
    ],
    timestamp: Date.now(),
  } as unknown as AgentMessage

  return [summaryMessage, ...recentMessages]
}

/**
 * 为 Chat 链路设计的简化版 compactMessages
 * (Chat 链路的消息是简化的 {role, content}[],不调用 LLM,采用字符串截断式压缩)
 * 保留作为 fallback;若需要 LLM 摘要可用 compactAgentMessages
 */
export function compactChatMessagesSimple(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  reserveTokens: number,
  keepRecentTokens: number,
): Array<{ role: string; content: string }> {
  if (messages.length <= 2) return messages
  const estimateOne = (s: string) => Math.ceil(s.length / 3)
  const totalTokens = messages.reduce((s, m) => s + estimateOne(m.content), 0)
  const threshold = maxTokens - reserveTokens
  if (totalTokens <= threshold) return messages

  let recentTokens = 0
  let splitIndex = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateOne(messages[i].content)
    if (recentTokens + t > keepRecentTokens) break
    recentTokens += t
    splitIndex = i
  }
  if (splitIndex >= messages.length) splitIndex = messages.length - 1
  const oldMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)
  if (oldMessages.length === 0) return messages
  const oldTokens = oldMessages.reduce((s, m) => s + estimateOne(m.content), 0)
  const summary =
    `[对话历史压缩] 之前 ${oldMessages.length} 条消息(约 ${oldTokens} tokens)已被压缩:\n` +
    oldMessages
      .map(
        (m, i) =>
          `${i + 1}. [${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`,
      )
      .join('\n')
  return [{ role: 'user', content: summary }, ...recentMessages]
}

// Re-export SDK 工具,方便其他模块统一引用
export { completeSimple, estimateContextTokens, generateSummary, getEnvApiKey }
