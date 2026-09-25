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

import { completeSimple } from '@earendil-works/pi-ai/compat'
import type { AgentMessage, Api, CompactionSettings, Model } from '@main/services/llm-contracts'
import { errText } from '../utils/err-text'

// =============================================================
// 本地实现（原 @earendil-works/pi-agent-core 的压缩工具函数）
// =============================================================

/**
 * 将 AgentMessage[] 转换为 LLM 兼容的 Message[]（本项目 AgentMessage = Message，直接返回）。
 * 原 pi-agent-core 的 convertToLlm 会过滤掉非标准消息类型。
 */
function convertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages
}

/**
 * 估算消息列表的 token 数。
 * 原 pi-agent-core 的 estimateContextTokens 基于 provider usage 数据。
 * 本项目已有 CJK 感知的 estimateMessageTokens，这里复用。
 */
function estimateContextTokens(messages: AgentMessage[]): { tokens: number } {
  let tokens = 0
  for (const m of messages) {
    tokens += estimateMessageTokens(m)
  }
  return { tokens }
}

/**
 * 将 LLM 消息列表序列化为文本，供摘要 prompt 使用。
 * 原 pi-agent-core 的 serializeConversation 格式为 "role: content" 逐条排列。
 */
function serializeConversation(messages: AgentMessage[]): string {
  return messages
    .map((m) => {
      const role = (m as { role?: string }).role ?? 'unknown'
      const content = (m as { content?: unknown }).content
      let text = ''
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content)) {
        text = content
          .map((b: { type?: string; text?: string }) =>
            b.type === 'text' ? (b.text ?? '') : `[${b.type ?? 'unknown'}]`,
          )
          .join('')
      } else if (content && typeof content === 'object') {
        try {
          text = JSON.stringify(content)
        } catch {
          text = ''
        }
      }
      return `${role}: ${text}`
    })
    .join('\n')
}

/**
 * 压缩阈值结果
 */
interface CompactionDecision {
  /** 是否需要压缩 */
  shouldCompact: boolean
  /** 估算的 token 数 */
  contextTokens: number
  /** 阈值 (contextWindow - reserveTokens) */
  threshold: number
}

/**
 * reserveTokens 自适应上限(Bug-2 修复,原为 pi-ai/streaming.ts 与 agent/execution.ts 双份实现):
 * 上限取 contextWindow 的 10%,下限 4096。
 * 之前直接用 settings.chat.compaction.reserveTokens 死值 8000:
 * contextWindow=900K 时相对太小,model.contextWindow=32K 时相对太大。
 */
export function computeAdaptiveReserve(reserveTokens: number, contextWindow: number): number {
  return Math.max(4096, Math.min(reserveTokens, Math.floor(contextWindow * 0.1)))
}

/**
 * M16 消重: 单条消息的 token 估算(2026-08-28 智能轮升级为 CJK 感知)。
 * 此前 evaluateCompaction 的兜底估算与 compactAgentMessages 的 estimateOne
 * 各自手写同一套规则,agent/execution.ts 的预检查是第三份变体——
 * 现在三处共用本函数,规则升级(如调整 image 折算)只改一处。
 * 历史版本 estimateMessageChars(纯字符统计,/4 折算)已无消费方,随本轮移除。
 */

/**
 * CJK 感知的文本 token 估算。
 * 此前统一 chars/4(英文经验值),中文实际约 1.5~2 字符/token — 低估约 3 倍,
 * 后果是 keepRecent 切分按膨胀前的量保留消息,压缩后仍超真实窗口,
 * 长中文会话反复触发压缩直至 API 上下文超限硬报错。
 * 现按字符类别分段: CJK ≈ 0.6 token/字, 其余沿用 SDK 的 ≈ 0.25 token/字符。
 */
function estimateTokensFromText(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字 + 扩展A + CJK 符号/标点 + 全角形式
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk * 0.6 + other * 0.25)
}

/**
 * 单条消息的 token 估算(CJK 感知)。结构与 estimateMessageChars 同源:
 * text/thinking 按真实文本分段估算,image 折算 4800 字符,toolCall/其他对象按序列化文本估算。
 */
export function estimateMessageTokens(m: AgentMessage | undefined | null): number {
  if (!m) return 0
  const content = (m as { content?: unknown }).content
  if (typeof content === 'string') return estimateTokensFromText(content)
  if (Array.isArray(content)) {
    let tokens = 0
    for (const raw of content) {
      const b = raw as {
        type?: string
        text?: string
        thinking?: string
        name?: string
        arguments?: unknown
      }
      if (b.type === 'text' && b.text) tokens += estimateTokensFromText(b.text)
      else if (b.type === 'thinking' && b.thinking) tokens += estimateTokensFromText(b.thinking)
      else if (b.type === 'image')
        tokens += 1200 // 4800 字符 × 0.25
      else if (b.type === 'toolCall')
        tokens += estimateTokensFromText((b.name ?? '') + JSON.stringify(b.arguments ?? {}))
    }
    return tokens
  }
  if (typeof content === 'object' && content !== null) {
    try {
      return estimateTokensFromText(JSON.stringify(content))
    } catch {
      return 0
    }
  }
  return 0
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
  // 防御性: SDK 的 estimateContextTokens 对 null/object content 会抛错
  // 我们先过滤掉非标准的 content 类型,保证不会崩
  // R132 修复: 同时过滤 undefined/null 元素 (SDK 在 error turn 时可能产生 undefined 元素)
  const safeMessages = messages.filter((m) => {
    if (!m) return false
    const c = (m as { content?: unknown }).content
    return c === null || c === undefined || typeof c === 'string' || Array.isArray(c)
  })
  let sdkTokens = 0
  try {
    const result = estimateContextTokens(safeMessages)
    sdkTokens = result.tokens
  } catch (err) {
    // SDK 抛错时静默回退到字符估算
    console.warn('[Compaction] SDK estimateContextTokens failed, falling back:', err)
  }
  // 兜底估算: CJK 感知分段估算(中文 ≈0.6 token/字,其余 ≈0.25 token/字符)
  // 此前 chars/4 按英文经验值,中文场景低估约 3 倍 → 长中文会话压缩后仍超真实窗口
  // (M16: 统计规则收敛到 estimateMessageTokens,null 跳过语义保留在函数内)
  let charTokens = 0
  for (const m of messages) {
    charTokens += estimateMessageTokens(m)
  }
  const tokens = Math.max(sdkTokens, charTokens)
  const threshold = model.contextWindow - settings.reserveTokens
  return {
    shouldCompact: settings.enabled && tokens > threshold,
    contextTokens: tokens,
    threshold,
  }
}

/**
 * 0.80.3 适配：用 compat 层 completeSimple 生成对话摘要。
 * 替代 SDK generateSummary（0.80.3 改为需要 Models 注册表）。
 * 行为等价：把 oldMessages 序列化后让模型产出结构化摘要。
 * 失败返回 null，调用方据此跳过压缩（不破坏 Agent 运行）。
 */
async function generateSummaryInline(
  oldMessages: AgentMessage[],
  model: Model<Api>,
  apiKey: string,
  reserveTokens: number,
  signal?: AbortSignal,
): Promise<string | null> {
  // 复用 SDK 的序列化工具，保证与原 generateSummary 行为一致
  const llmMessages = convertToLlm(oldMessages)
  const conversationText = serializeConversation(llmMessages)

  const promptText =
    `<conversation>\n${conversationText}\n</conversation>\n\n` +
    '请对以上对话生成一份结构化摘要：保留关键决策、已完成的任务、未解决的问题和重要上下文。' +
    '用简洁的要点列出，便于后续对话继续。只输出摘要本身。'

  try {
    const assistant = await completeSimple(
      model,
      { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
      {
        apiKey,
        maxTokens: Math.min(Math.floor(0.8 * reserveTokens), model.maxTokens || 2048),
        signal,
      },
    )
    // AssistantMessage.content 可能是 string 或内容块数组
    const c = assistant.content
    if (typeof c === 'string') return c || null
    if (Array.isArray(c)) {
      const text = c
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String(b.text) : ''))
        .join('')
      return text || null
    }
    return String(c ?? '') || null
  } catch (err) {
    console.warn('[Compaction] generateSummaryInline failed:', errText(err))
    return null
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
  // R132 修复: 过滤掉 undefined/null 元素 (SDK 在 error turn 时可能产生 undefined 元素,
  // 导致 evaluateCompaction 的 filter 回调 / convertToLlm 崩溃)
  // 优化: 若没有过滤掉任何元素,直接复用原数组引用,避免无谓拷贝 (也让"原样返回"语义精确)
  const cleanMessages =
    messages.length === 0 || messages.every((m) => m != null)
      ? messages
      : messages.filter((m) => m != null)
  if (cleanMessages.length <= 2) return cleanMessages

  const decision = evaluateCompaction(cleanMessages, model, settings)
  if (!decision.shouldCompact) return cleanMessages

  console.log(
    `[Compaction] Triggered: ${decision.contextTokens} tokens > ${decision.threshold} threshold ` +
      `(window=${model.contextWindow}, reserve=${settings.reserveTokens}, keepRecent=${settings.keepRecentTokens})`,
  )

  // 找到 splitIndex:从尾部向前累计 token,达到 keepRecentTokens 时停止
  // keepRecentTokens 上限按 contextWindow 收敛(40%): 小窗口模型(如 8K)上,
  // 用户填的 16000 会让全部消息都算"近期"→ oldMessages 为空 → 压缩空转,
  // 每轮触发却不产出,最终 API 上下文超限报错
  const effectiveKeepRecent = Math.min(
    settings.keepRecentTokens,
    Math.max(1, Math.floor(model.contextWindow * 0.4)),
  )
  let recentTokens = 0
  let splitIndex = cleanMessages.length
  // CJK 感知估算(estimateTokensFromText): 中文 ≈0.6 token/字,其余 ≈0.25 token/字符
  // (M16: 统计规则收敛到 estimateMessageTokens,null 跳过语义保留在函数内)
  for (let i = cleanMessages.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(cleanMessages[i])
    if (recentTokens + t > effectiveKeepRecent) break
    recentTokens += t
    splitIndex = i
  }

  // 至少保留最后 1 条
  if (splitIndex >= cleanMessages.length) splitIndex = cleanMessages.length - 1

  const oldMessages = cleanMessages.slice(0, splitIndex)
  const recentMessages = cleanMessages.slice(splitIndex)

  if (oldMessages.length === 0) return cleanMessages

  // 0.80.3 升级适配：SDK 的 generateSummary 改为需要 Models 注册表（新鉴权架构），
  // 与本应用基于 apiKey 的旧链路不兼容。这里用 compat 层的 completeSimple
  // 自行生成摘要，行为等价、鉴权沿用 apiKey 透传。
  const summaryText = await generateSummaryInline(
    oldMessages,
    model,
    apiKey,
    settings.reserveTokens,
    signal,
  )

  if (!summaryText) {
    console.warn(`[Compaction] Summary generation failed, skipping`)
    return cleanMessages
  }
  console.log(
    `[Compaction] Generated ${summaryText.length} chars summary for ${oldMessages.length} old messages, ` +
      `kept ${recentMessages.length} recent messages (${recentTokens} tokens)`,
  )

  // 构造 summary 作为 user 消息(自定义类型 compactionSummary)
  // L-5 修复: 移除不安全的 as unknown as 双重断言,用类型安全的构造方式
  const summaryMessage = {
    role: 'user' as const,
    content: [
      {
        type: 'text' as const,
        text: `[对话历史压缩] 之前 ${oldMessages.length} 条消息已被压缩为以下摘要(本消息由系统注入,不是用户发言,作为背景参考即可):\n\n${summaryText}`,
      },
    ],
    timestamp: Date.now(),
  } as AgentMessage

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
  // R132 修复: 防御性过滤 undefined/null 元素
  const clean = messages.filter((m) => m && typeof m.content === 'string')
  if (clean.length <= 2) return clean
  const estimateOne = (s: string) => estimateTokensFromText(s)
  const totalTokens = clean.reduce((s, m) => s + estimateOne(m.content), 0)
  const threshold = maxTokens - reserveTokens
  if (totalTokens <= threshold) return clean

  let recentTokens = 0
  let splitIndex = clean.length
  for (let i = clean.length - 1; i >= 0; i--) {
    const t = estimateOne(clean[i].content)
    if (recentTokens + t > keepRecentTokens) break
    recentTokens += t
    splitIndex = i
  }
  if (splitIndex >= clean.length) splitIndex = clean.length - 1
  const oldMessages = clean.slice(0, splitIndex)
  const recentMessages = clean.slice(splitIndex)
  if (oldMessages.length === 0) return clean
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
