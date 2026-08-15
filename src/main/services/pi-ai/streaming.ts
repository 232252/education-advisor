// =============================================================
// Pi AI — 流式对话执行器: 流式调用 / 自动重试 / 首字节超时 / abort / 对话压缩
// 从 pi-ai-service.ts 拆出。逻辑零修改(逐行对照搬迁)。
//
// 状态搬移说明:
//   abortController 原为 PiAIService 实例字段(单例,chatStream 与
//   公共 abortCurrentChat 共享),现由 ChatStreamRunner 内部持有
//   (F4 清理后仅用于并发隔离与信号检查,无公共中止入口),并发行为不变。
// =============================================================

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type AssistantMessage,
  type Context,
  getEnvApiKey,
  type Message,
  type ModelThinkingLevel,
  streamSimple,
  type ThinkingLevel,
} from '@earendil-works/pi-ai/compat'
import type { StreamEvent } from '@shared/types'
import {
  compactAgentMessages,
  compactChatMessagesSimple,
  computeAdaptiveReserve,
} from '../compaction-helper'
import { keystoreService } from '../keystore-service'
// KEYLESS_PROVIDERS 从 ollama/constants 导入,避免经 ollama-service 把 electron 拉进依赖链
import { KEYLESS_PROVIDERS } from '../ollama/constants'
import { isRetryableError, mapEvent } from '../pi-ai-helpers'
import { settingsService } from '../settings-service'
import { resolveModel } from './model-utils'

export class ChatStreamRunner {
  private abortController: AbortController | null = null

  /**
   * 流式对话 - 返回异步迭代器，供 IPC handler 逐事件转发到渲染进程
   */
  async *chatStream(params: {
    providerId: string
    modelId: string
    messages: Array<{ role: string; content: string }>
    systemPrompt?: string
    thinking?: ModelThinkingLevel
    maxTokens?: number
  }): AsyncGenerator<StreamEvent> {
    // ✅ [Settings wiring] 读取 models.retry.* 配置 (R132 修复: 前置读取,
    // 使所有 error 路径(包括 model-not-found / no-api-key / empty-messages)
    // 都能附带 retry 元信息,保证渲染端 UI 一致性)
    // 默认值:enabled=true / maxRetries=3 / baseDelayMs=1000 / providerTimeoutMs=60000
    let retryEnabled = true
    let maxRetries = 3
    let baseDelayMs = 1000
    let providerTimeoutMs = 60000
    try {
      const r = settingsService.getSettings().models?.retry
      if (r) {
        if (typeof r.enabled === 'boolean') retryEnabled = r.enabled
        if (typeof r.maxRetries === 'number' && r.maxRetries >= 0) maxRetries = r.maxRetries
        if (typeof r.baseDelayMs === 'number' && r.baseDelayMs > 0) baseDelayMs = r.baseDelayMs
        if (typeof r.providerTimeoutMs === 'number' && r.providerTimeoutMs > 0) {
          providerTimeoutMs = r.providerTimeoutMs
        }
      }
    } catch (err) {
      console.warn('[PiAI] Failed to read models.retry.* from settings:', err)
    }
    /** 构造 retry 元信息对象,附在 error 事件上供渲染端决定是否显示重试按钮 */
    const buildRetryInfo = (retryable: boolean) => ({
      enabled: retryEnabled,
      maxRetries,
      baseDelayMs,
      providerTimeoutMs,
      shouldRetry: retryable && retryEnabled && maxRetries > 0,
    })

    // 解析模型
    const model = resolveModel(params.providerId, params.modelId)
    if (!model) {
      yield {
        type: 'error',
        message: `Model not found: ${params.providerId}/${params.modelId}`,
        retryable: false,
        retry: buildRetryInfo(false),
      }
      return
    }
    const isLocalKeyless = KEYLESS_PROVIDERS.has(params.providerId)
    const apiKey = isLocalKeyless
      ? 'local-no-key-needed'
      : (keystoreService.getApiKey(params.providerId) ?? getEnvApiKey(params.providerId))

    if (!apiKey) {
      yield {
        type: 'error',
        message: `No API key for provider: ${params.providerId}`,
        retryable: false,
        retry: buildRetryInfo(false),
      }
      return
    }

    // 创建 AbortController
    // Critical 4.1 修复: 并发 chatStream 会覆盖 abortController,导致前一个无法 abort
    // 策略 1: 进入新 chatStream 前先 abort 并清理旧的 controller,保证只有一个活跃流
    // 策略 2: 记录自己的 controller 引用,finally 只清理自己创建的 controller,
    //         避免在并发场景下错误地清理另一个流的 controller
    if (this.abortController) {
      try {
        this.abortController.abort()
      } catch {
        /* 旧 controller abort 失败不阻塞新流程 */
      }
      this.abortController = null
    }
    this.abortController = new AbortController()
    // 保留自己 controller 的引用,用于 finally 中精确清理
    const myController = this.abortController

    // 构建 pi-ai Context
    // H-5 修复: 不再只取 user 消息,保留 user + assistant 消息以维持完整对话上下文
    // 之前 filter(m => m.role === 'user') 会导致 assistant 的历史回复丢失,
    // LLM 无法理解多轮对话的连贯性
    const conversationMessages = params.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )

    // 边界：conversationMessages 为空时直接返回 (不能仅检查 params.messages,
    // 因为可能只含 system/tool 消息,过滤后为空)
    if (conversationMessages.length === 0) {
      yield {
        type: 'error',
        message: 'No messages to send',
        retryable: false,
        retry: buildRetryInfo(false),
      }
      return
    }

    // ✅ [Settings wiring] maxTokens 默认值
    // 修复 Bug-1: 之前用 settings.chat.maxTokens 死值(默认 4096/32K)覆盖了 model.maxTokens
    // 现在优先级: 显式传参 > model.maxTokens(用户的 900K 模型自带 32K-128K) > settings 默认 > 4096
    let defaultMaxTokens = 4096
    try {
      const s = settingsService.getSettings()
      const v = s.chat?.maxTokens
      if (typeof v === 'number' && v > 0) defaultMaxTokens = v
    } catch (err) {
      console.warn('[PiAI] Failed to read chat.maxTokens from settings:', err)
    }
    // 修复 Bug-1: maxTokens 至少要 >= model.maxTokens, 不然用户设的 900K 模型收到 4K 截断
    const effectiveOutputMax = Math.max(
      model.maxTokens > 0 ? model.maxTokens : 4096,
      params.maxTokens ?? defaultMaxTokens,
    )
    console.log(
      `[PiAI] chatStream: model.contextWindow=${model.contextWindow} model.maxTokens=${model.maxTokens} effectiveOutputMax=${effectiveOutputMax}`,
    )

    // ✅ [Settings wiring] 对话压缩:读取 compaction 设置并在构建 Context 前压缩旧消息
    // Chat 链路: 调 LLM 生成结构化摘要(与 Agent 链路一致),失败时回退到字符串截断
    // 修复 Bug-2: reserveTokens 上限按 model.contextWindow 自适应(10%, 至少 4096)
    let compactionEnabled = false
    let reserveTokens = 8000
    let keepRecentTokens = 16000
    try {
      const s = settingsService.getSettings()
      compactionEnabled = s.chat?.compaction?.enabled ?? false
      reserveTokens = s.chat?.compaction?.reserveTokens ?? 8000
      keepRecentTokens = s.chat?.compaction?.keepRecentTokens ?? 16000
    } catch {
      /* 默认值 */
    }
    // 自适应: 当 model.contextWindow 巨大(如 900K)时不应用用户填的 8K reserve
    // 实现提取到 compaction-helper.computeAdaptiveReserve(与 Agent 链路共用)
    const adaptiveReserve = computeAdaptiveReserve(reserveTokens, model.contextWindow)

    // 应用压缩(仅当启用且消息数量 > 2)
    // 优先使用 LLM 摘要(与 Agent 链路体验一致),失败时降级到字符串截断
    // H-5 修复: 使用 conversationMessages(含 user + assistant)而非只 user 消息
    const sourceMessages = conversationMessages.length > 0 ? conversationMessages : params.messages
    let messagesToUse: Array<{ role: string; content: string }> = sourceMessages

    if (compactionEnabled && sourceMessages.length > 2) {
      // 构造 AgentMessage 序列供 compactAgentMessages 使用
      // 使用宽松 cast: Chat 链路只关心 user-role 文本
      const agentMsgs: AgentMessage[] = sourceMessages.map(
        (m, i) =>
          ({
            role: 'user',
            content: m.content,
            timestamp: Date.now() - (sourceMessages.length - i) * 1000,
          }) as unknown as AgentMessage,
      )
      try {
        const compacted = await compactAgentMessages(
          agentMsgs,
          model,
          { enabled: true, reserveTokens: adaptiveReserve, keepRecentTokens },
          apiKey,
          myController.signal,
        )
        if (compacted.length < agentMsgs.length) {
          // 压缩生效:把结果转回简化格式(宽松 cast 处理 AgentMessage 联合类型)
          messagesToUse = compacted.map((m) => {
            const content = (m as { content?: unknown }).content
            const role = (m as { role?: string }).role ?? 'user'
            if (typeof content === 'string') return { role, content }
            if (Array.isArray(content)) {
              const text = content
                .filter((raw): raw is { type: 'text'; text: string } => {
                  const b = raw as { type?: string; text?: string }
                  return b?.type === 'text' && typeof b.text === 'string'
                })
                .map((b) => b.text)
                .join('\n')
              return { role, content: text }
            }
            return { role, content: String(content ?? '') }
          })
          console.log(
            `[PiAI] Compaction: ${sourceMessages.length} → ${messagesToUse.length} messages`,
          )
        }
      } catch (err) {
        console.warn('[PiAI] LLM compaction failed, falling back to truncation:', err)
        // 降级到字符串截断
        messagesToUse = compactChatMessagesSimple(
          sourceMessages,
          model.contextWindow,
          adaptiveReserve,
          keepRecentTokens,
        )
      }
    }

    // H-5 修复: 根据原消息 role 构造对应的 pi-ai Message 类型
    // - user 消息 → UserMessage (简单)
    // - assistant 消息 → 最小合法 AssistantMessage (保留历史回复上下文)
    // 之前所有消息都强制转 role: 'user',导致 LLM 误以为全是用户说的,多轮对话混乱
    const piMessages: Message[] = messagesToUse.map((m) => {
      if (m.role === 'assistant') {
        // 构造最小合法 AssistantMessage,让 pi-ai 能识别这是之前的助手回复
        return {
          role: 'assistant',
          content: [{ type: 'text', text: m.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as AssistantMessage
      }
      // user 和其他角色都作为 UserMessage
      return {
        role: 'user' as const,
        content: m.content,
        timestamp: Date.now(),
      }
    })

    const context: Context = {
      systemPrompt: params.systemPrompt,
      messages: piMessages,
    }

    // reasoning 默认值：仅当模型支持时使用 params.thinking 或 'low'
    // 修复: 'off' 不在 ThinkingLevel 中 ('minimal'|'low'|'medium'|'high'|'xhigh'),
    // 但 streamSimple 接收的是 ThinkingLevel | undefined, 所以排除 'off'
    const reasoning: ThinkingLevel | undefined = model.reasoning
      ? params.thinking === 'off'
        ? 'low'
        : (params.thinking ?? 'low')
      : undefined

    // 发起流式请求
    // 修复 Bug-1: 之前用 params.maxTokens ?? defaultMaxTokens (4096) 覆盖了 model.maxTokens
    // 现在用 effectiveOutputMax (max(model.maxTokens, params.maxTokens ?? defaultMaxTokens))
    // GAP-2 修复: 改为函数式创建,使自动重试能重建 stream(async iterable 消费后不可复用)。
    // R-TIMEOUT 修复: providerTimeoutMs 真正应用到请求 —— 作为"首字节超时"。
    //   修复前该值只进日志,provider 挂起(不返回任何数据)时聊天会无限等待。
    //   现在: 超时内无任何事件 → abort 并抛含 'timeout' 的错误 → 进入 isRetryableError 自动重试;
    //   收到首个事件后立即取消计时(长生成不受影响)。
    const createStream = () => {
      const streamAbort = new AbortController()
      let firstByteTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        streamAbort.abort(
          new Error(`Provider connection timeout (${providerTimeoutMs}ms 无响应, 已触发自动重试)`),
        )
      }, providerTimeoutMs)
      const onOuterAbort = () => streamAbort.abort()
      myController.signal.addEventListener('abort', onOuterAbort, { once: true })
      const iter = streamSimple(model, context, {
        apiKey,
        reasoning,
        maxTokens: effectiveOutputMax,
        signal: streamAbort.signal,
      })
      return (async function* () {
        try {
          for await (const evt of iter) {
            if (firstByteTimer) {
              clearTimeout(firstByteTimer)
              firstByteTimer = null
            }
            yield evt
          }
        } finally {
          if (firstByteTimer) clearTimeout(firstByteTimer)
          myController.signal.removeEventListener('abort', onOuterAbort)
        }
      })()
    }

    yield { type: 'start', model: model.id, provider: model.provider }

    // 注: retry 配置已在函数开头读取 (R132 修复: 前置以使所有 error 路径都附带 retry 元信息)
    // GAP-2: 实现真实的自动重试。策略: 在向用户输出任何 token 之前(即 yieldedAny=false)遇到
    // retryable 错误时,按指数退避重建 stream 重试;一旦已输出 token 则不再重试(避免重复输出)。
    console.log(
      `[PiAI] retry policy: enabled=${retryEnabled} maxRetries=${maxRetries} baseDelay=${baseDelayMs}ms timeout=${providerTimeoutMs}ms`,
    )

    // T2: AI 流事件全量落盘(chat.conversationLogging 关闭时跳过)
    let conversationLogging = true
    try {
      conversationLogging = settingsService.getSettings().chat?.conversationLogging !== false
    } catch {
      /* 默认 true */
    }

    // 惰性加载 logChat: utils/logger → log/state 顶层 import electron,
    // 静态导入会把 electron 拉进本模块静态依赖链(破坏纯函数模块的单测环境)
    const { logChat } = await import('../../utils/logger')

    try {
      let attempt = 0
      let yieldedAny = false // 是否已向用户 yield 过事件(一旦 true 就不能重试)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let stream: ReturnType<typeof createStream>
        try {
          stream = createStream()
          for await (const event of stream) {
            const mapped = mapEvent(event)
            if (mapped) {
              yieldedAny = true
              if (conversationLogging) {
                logChat('event', { type: mapped.type, ...(mapped as object) })
              }
              yield mapped
            }
          }
          break // 正常消费完毕,退出重试循环
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          const retryable = isRetryableError(message)
          // GAP-2: 仅当 (a)开启了重试 (b)错误可重试 (c)尚未向用户输出任何 token (d)未超最大次数 时自动重试
          const canAutoRetry =
            retryEnabled &&
            retryable &&
            !yieldedAny &&
            attempt < maxRetries &&
            !myController.signal.aborted
          if (!canAutoRetry) {
            yield {
              type: 'error',
              message,
              retryable,
              retry: buildRetryInfo(retryable),
            }
            break
          }
          // 指数退避: baseDelay * 2^attempt (+ 小 jitter)
          const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100)
          attempt++
          console.log(
            `[PiAI] auto-retry attempt ${attempt}/${maxRetries} after ${delay}ms (error: ${message})`,
          )
          yield { type: 'retry', attempt, maxRetries, delayMs: delay, reason: message }
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    } finally {
      // Critical 4.1 修复: 只清理自己创建的 controller,避免覆盖另一个并发 chatStream 的 controller
      if (this.abortController === myController) {
        this.abortController = null
      }
    }
  }
}
