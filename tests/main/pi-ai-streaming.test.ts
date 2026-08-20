// =============================================================
// pi-ai/streaming — ChatStreamRunner 流式执行器测试 (M34)
//
// 覆盖用例矩阵:
//   1. 正常事件流序列透传(多事件一流,顺序保持) + text_delta 分段合并
//   2. 错误事件转换(流内 error 事件 → 前端 StreamEvent)
//   3. abort 中途取消(新 chatStream abort 旧流, Critical 4.1 并发隔离)
//   4. 首字节超时触发自动重试(fake timers)
//   5. 重试耗尽抛错 / retry 禁用 / 已输出 token 后不再重试
//   6. 消息格式互转往返(简化 {role,content} ↔ AgentMessage ↔ pi-ai Message)
//
// 说明: SSE 字节级帧解析在 vendored pi-ai 内部完成,本模块消费的是
// 归一后的 AssistantMessageEvent 序列——测试以事件序列注入(mock
// streamSimple)驱动,分段/帧边界语义由"多 delta 事件顺序透传 + 合并"
// 用例覆盖。纯单测,无真实网络。
// =============================================================

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai/compat'
import type { StreamEvent } from '@shared/types'

const piMocks = vi.hoisted(() => ({
  streamSimple: vi.fn(),
  getEnvApiKey: vi.fn(),
  keystoreGetApiKey: vi.fn(),
  settingsGet: vi.fn(),
  logChat: vi.fn(),
  resolveModel: vi.fn(),
  compactAgentMessages: vi.fn(),
  compactChatMessagesSimple: vi.fn(),
  computeAdaptiveReserve: vi.fn(),
}))

// streaming.ts 运行时只消费 compat 的 streamSimple / getEnvApiKey 两个值,
// 其余(类型)编译后消失 → 完全 mock,不加载 vendored 模块
vi.mock('@earendil-works/pi-ai/compat', () => ({
  streamSimple: piMocks.streamSimple,
  getEnvApiKey: piMocks.getEnvApiKey,
}))

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: piMocks.keystoreGetApiKey },
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: piMocks.settingsGet },
}))

vi.mock('../../src/main/services/compaction-helper', () => ({
  compactAgentMessages: piMocks.compactAgentMessages,
  compactChatMessagesSimple: piMocks.compactChatMessagesSimple,
  computeAdaptiveReserve: piMocks.computeAdaptiveReserve,
}))

vi.mock('../../src/main/services/pi-ai/model-utils', () => ({
  resolveModel: piMocks.resolveModel,
}))

// utils/logger 顶层 import electron,streaming.ts 惰性动态导入 → 由 mock 拦截
vi.mock('../../src/main/utils/logger', () => ({
  logChat: piMocks.logChat,
}))

const { ChatStreamRunner } = await import('../../src/main/services/pi-ai/streaming')

// ===========================================================
// Helpers
// ===========================================================

function testModel(over: Record<string, unknown> = {}) {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.test/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...over,
  }
}

function defaultSettings(over: Record<string, unknown> = {}) {
  return {
    models: {
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000, providerTimeoutMs: 60000 },
    },
    chat: {
      maxTokens: 4096,
      compaction: { enabled: false, reserveTokens: 8000, keepRecentTokens: 16000 },
      conversationLogging: false,
    },
    ...over,
  }
}

function chatParams(over: Record<string, unknown> = {}) {
  return {
    providerId: 'openai',
    modelId: 'test-model',
    messages: [{ role: 'user', content: '你好' }],
    ...over,
  }
}

function ev(e: Record<string, unknown>): AssistantMessageEvent {
  return e as unknown as AssistantMessageEvent
}

/** 事件工厂: 与 pi-ai AssistantMessageEvent 对应(宽松构造) */
const T = {
  textStart: () => ev({ type: 'text_start' }),
  textDelta: (delta: string) => ev({ type: 'text_delta', delta }),
  textEnd: () => ev({ type: 'text_end' }),
  thinkStart: () => ev({ type: 'thinking_start' }),
  thinkDelta: (delta: string) => ev({ type: 'thinking_delta', delta }),
  thinkEnd: () => ev({ type: 'thinking_end' }),
  toolStart: (id: string, name: string) =>
    ev({
      type: 'toolcall_start',
      contentIndex: 0,
      partial: { content: [{ type: 'toolCall', id, name, arguments: {} }] },
    }),
  toolDelta: (delta: string) => ev({ type: 'toolcall_delta', delta }),
  toolEnd: (id: string) => ev({ type: 'toolcall_end', toolCall: { id, name: 'x', arguments: {} } }),
  done: (usage?: Record<string, unknown>) => ev({ type: 'done', reason: 'stop', message: { usage } }),
  err: (errorMessage: string | undefined, reason: 'aborted' | 'error') =>
    ev({ type: 'error', reason, error: { errorMessage } }),
}

/** 正常事件流: 按序 yield 后结束 */
function evtStream(events: AssistantMessageEvent[]) {
  return (async function* () {
    yield* events
  })()
}

/** 挂起流: 永不产出首事件,直到 signal abort 时以 signal.reason 抛错(模拟 provider 挂起) */
function hangStream(signal?: AbortSignal) {
  return (async function* () {
    await new Promise<never>((_, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('Aborted'))
        return
      }
      signal?.addEventListener(
        'abort',
        () => reject(signal.reason ?? new Error('Aborted')),
        { once: true },
      )
    })
  })()
}

/** 消费 async generator 收集全部事件 */
async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

function typesOf(events: StreamEvent[]): string[] {
  return events.map((e) => e.type)
}

/** 取 streamSimple 第 n 次调用的 (model, context, options) */
function streamCall(n = 0): {
  model: ReturnType<typeof testModel>
  context: { systemPrompt?: string; messages: Array<{ role: string; content: unknown }> }
  options: { apiKey: string; reasoning?: string; maxTokens: number; signal: AbortSignal }
} {
  const call = piMocks.streamSimple.mock.calls[n] as unknown[]
  return {
    model: call[0] as ReturnType<typeof testModel>,
    context: call[1] as { systemPrompt?: string; messages: Array<{ role: string; content: unknown }> },
    options: call[2] as { apiKey: string; reasoning?: string; maxTokens: number; signal: AbortSignal },
  }
}

const originalLog = console.log

beforeAll(() => {
  console.log = () => {}
})

afterAll(() => {
  console.log = originalLog
})

beforeEach(() => {
  vi.clearAllMocks()
  piMocks.resolveModel.mockReturnValue(testModel())
  piMocks.settingsGet.mockReturnValue(defaultSettings())
  piMocks.keystoreGetApiKey.mockReturnValue('sk-test')
  piMocks.getEnvApiKey.mockReturnValue(undefined)
  piMocks.streamSimple.mockImplementation(() => evtStream([T.done()]))
  piMocks.compactAgentMessages.mockResolvedValue([])
  piMocks.compactChatMessagesSimple.mockReturnValue([])
  // 保留真实语义的副本,使压缩分支收到的 adaptive 值可预测
  piMocks.computeAdaptiveReserve.mockImplementation(
    (r: number, cw: number) => Math.max(4096, Math.min(r, Math.floor(cw * 0.1))),
  )
  piMocks.logChat.mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
// ===========================================================
// 前置校验与配置读取
// ===========================================================

describe('ChatStreamRunner — 前置校验', () => {
  it('模型不存在 → yield error 事件(retryable=false, 附完整 retry 元信息)', async () => {
    piMocks.resolveModel.mockReturnValue(undefined)
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'error',
      message: 'Model not found: openai/test-model',
      retryable: false,
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        providerTimeoutMs: 60000,
        shouldRetry: false,
      },
    })
    expect(piMocks.streamSimple).not.toHaveBeenCalled()
  })

  it('keystore 与环境变量均无 key → yield error 且不发起请求', async () => {
    piMocks.keystoreGetApiKey.mockReturnValue(undefined)
    piMocks.getEnvApiKey.mockReturnValue(undefined)
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'error',
      message: 'No API key for provider: openai',
      retryable: false,
    })
    expect(piMocks.streamSimple).not.toHaveBeenCalled()
  })

  it('keystore key 优先于环境变量 key', async () => {
    piMocks.keystoreGetApiKey.mockReturnValue('sk-store')
    piMocks.getEnvApiKey.mockReturnValue('sk-env')
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.apiKey).toBe('sk-store')
  })

  it('keystore 无 key 时回退环境变量 key', async () => {
    piMocks.keystoreGetApiKey.mockReturnValue(undefined)
    piMocks.getEnvApiKey.mockReturnValue('sk-env')
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.apiKey).toBe('sk-env')
  })

  it('keyless provider(ollama) → 免 key 直连,不查询 keystore', async () => {
    await collect(new ChatStreamRunner().chatStream(chatParams({ providerId: 'ollama' })))
    expect(piMocks.keystoreGetApiKey).not.toHaveBeenCalled()
    expect(streamCall().options.apiKey).toBe('local-no-key-needed')
  })

  it('消息过滤后为空(仅 system 消息) → yield error', async () => {
    const events = await collect(
      new ChatStreamRunner().chatStream(
        chatParams({ messages: [{ role: 'system', content: 'sys prompt' }] }),
      ),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', message: 'No messages to send', retryable: false })
    expect(piMocks.streamSimple).not.toHaveBeenCalled()
  })

  it('retry 配置含非法字段 → 忽略并使用默认值', async () => {
    piMocks.settingsGet.mockReturnValue({
      models: {
        retry: { enabled: 'yes', maxRetries: -1, baseDelayMs: 0, providerTimeoutMs: -5 },
      },
      chat: {},
    })
    piMocks.resolveModel.mockReturnValue(undefined) // 早退路径仍附带 retry 元信息
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events[0]).toMatchObject({
      type: 'error',
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        providerTimeoutMs: 60000,
        shouldRetry: false,
      },
    })
  })

  it('settings 读取抛错 → 走默认配置仍正常完成流(四个 catch 兜底)', async () => {
    piMocks.settingsGet.mockImplementation(() => {
      throw new Error('settings unavailable')
    })
    piMocks.streamSimple.mockImplementation(() => evtStream([T.textDelta('ok'), T.done()]))
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'text_delta', 'done'])
    // 默认 conversationLogging=true → logChat 记录事件
    expect(piMocks.logChat).toHaveBeenCalled()
    // 默认 compaction 关闭
    expect(piMocks.compactAgentMessages).not.toHaveBeenCalled()
  })
})

// ===========================================================
// 正常流: 事件序列透传 / delta 合并 / 错误事件转换
// ===========================================================

describe('ChatStreamRunner — 正常流事件处理', () => {
  it('完整事件序列顺序透传 + text_delta 分段合并 + done usage/cost 映射', async () => {
    piMocks.streamSimple.mockImplementation(() =>
      evtStream([
        T.textStart(),
        T.textDelta('你好'),
        T.textDelta('，'),
        T.textDelta('世界！'),
        T.textEnd(),
        T.thinkStart(),
        T.thinkDelta('思考中'),
        T.thinkEnd(),
        T.toolStart('tc_1', 'get_score'),
        T.toolDelta('{"student":"张三"}'),
        T.toolEnd('tc_1'),
        T.done({ input: 10, output: 20, cacheRead: 1, cacheWrite: 2, cost: { total: 0.5 } }),
      ]),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_delta',
      'text_delta',
      'text_end',
      'thinking_start',
      'thinking_delta',
      'thinking_end',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_end',
      'done',
    ])
    // start 事件内容来自 resolved model
    expect(events[0]).toEqual({ type: 'start', model: 'test-model', provider: 'openai' })
    // text_delta 逐段透传,拼接还原完整文本
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('')
    expect(text).toBe('你好，世界！')
    // thinking delta 透传
    expect(events.find((e) => e.type === 'thinking_delta')).toEqual({
      type: 'thinking_delta',
      delta: '思考中',
    })
    // toolcall 三事件转换
    expect(events.find((e) => e.type === 'toolcall_start')).toEqual({
      type: 'toolcall_start',
      id: 'tc_1',
      name: 'get_score',
    })
    expect(events.find((e) => e.type === 'toolcall_delta')).toEqual({
      type: 'toolcall_delta',
      id: '',
      argsDelta: '{"student":"张三"}',
    })
    expect(events.find((e) => e.type === 'toolcall_end')).toEqual({
      type: 'toolcall_end',
      id: 'tc_1',
    })
    // done 事件 usage/cost 字段映射
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 1, cacheWriteTokens: 2 },
      cost: 0.5,
    })
  })

  it('done 事件无 usage → 默认全 0', async () => {
    piMocks.streamSimple.mockImplementation(() => evtStream([T.done()]))
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0,
    })
  })

  it('流内 error 事件(reason=aborted) → 转换为 retryable=true', async () => {
    piMocks.streamSimple.mockImplementation(() =>
      evtStream([T.err('connection dropped', 'aborted')]),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({
      type: 'error',
      message: 'connection dropped',
      retryable: true,
    })
  })

  it('流内 error 事件(reason=error, 无 errorMessage) → Unknown error + retryable=false', async () => {
    piMocks.streamSimple.mockImplementation(() => evtStream([T.err(undefined, 'error')]))
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(events[1]).toEqual({ type: 'error', message: 'Unknown error', retryable: false })
  })

  it('conversationLogging=true → 每个映射事件调用一次 logChat;false → 不调用', async () => {
    // true(记录)
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({ chat: { maxTokens: 4096, compaction: { enabled: false }, conversationLogging: true } }),
    )
    piMocks.streamSimple.mockImplementation(() => evtStream([T.textDelta('ok'), T.done()]))
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(piMocks.logChat).toHaveBeenCalledTimes(2)
    expect(piMocks.logChat.mock.calls[0]).toEqual(['event', { type: 'text_delta', delta: 'ok' }])

    // false(默认 settings): 不记录
    piMocks.settingsGet.mockReturnValue(defaultSettings()) // conversationLogging: false
    piMocks.streamSimple.mockClear()
    piMocks.logChat.mockClear()
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(piMocks.logChat).not.toHaveBeenCalled()
  })
})
// ===========================================================
// streamSimple 调用参数透传(systemPrompt / maxTokens / reasoning)
// ===========================================================

describe('ChatStreamRunner — 请求参数透传', () => {
  it('systemPrompt 与 apiKey 透传到 context/options', async () => {
    await collect(
      new ChatStreamRunner().chatStream(chatParams({ systemPrompt: 'You are helpful' })),
    )
    const { context, options } = streamCall()
    expect(context.systemPrompt).toBe('You are helpful')
    expect(options.apiKey).toBe('sk-test')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('显式 maxTokens 大于 model.maxTokens → 取显式值', async () => {
    await collect(new ChatStreamRunner().chatStream(chatParams({ maxTokens: 16000 })))
    expect(streamCall().options.maxTokens).toBe(16000)
  })

  it('未传 maxTokens → 取 max(model.maxTokens, settings 默认)', async () => {
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.maxTokens).toBe(8192) // model.maxTokens 8192 > 默认 4096
  })

  it('settings 默认 maxTokens 大于 model.maxTokens → 取 settings 值', async () => {
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({ chat: { maxTokens: 16384, compaction: { enabled: false }, conversationLogging: false } }),
    )
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.maxTokens).toBe(16384)
  })

  it('model.maxTokens 无效(0) → 兜底 4096 与默认值取大者', async () => {
    piMocks.resolveModel.mockReturnValue(testModel({ maxTokens: 0 }))
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.maxTokens).toBe(4096)
  })

  it('模型不支持 reasoning → options.reasoning 为 undefined', async () => {
    piMocks.resolveModel.mockReturnValue(testModel({ reasoning: false }))
    await collect(new ChatStreamRunner().chatStream(chatParams({ thinking: 'high' })))
    expect(streamCall().options.reasoning).toBeUndefined()
  })

  it('模型支持 reasoning 且 thinking 未指定 → 默认 low', async () => {
    piMocks.resolveModel.mockReturnValue(testModel({ reasoning: true }))
    await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(streamCall().options.reasoning).toBe('low')
  })

  it('模型支持 reasoning 且 thinking=off → 降级为 low', async () => {
    piMocks.resolveModel.mockReturnValue(testModel({ reasoning: true }))
    await collect(new ChatStreamRunner().chatStream(chatParams({ thinking: 'off' })))
    expect(streamCall().options.reasoning).toBe('low')
  })

  it('模型支持 reasoning 且 thinking=high → 透传 high', async () => {
    piMocks.resolveModel.mockReturnValue(testModel({ reasoning: true }))
    await collect(new ChatStreamRunner().chatStream(chatParams({ thinking: 'high' })))
    expect(streamCall().options.reasoning).toBe('high')
  })
})

// ===========================================================
// 消息格式互转往返(简化格式 ↔ AgentMessage ↔ pi-ai Message)
// ===========================================================

describe('ChatStreamRunner — 消息格式互转', () => {
  const fourMessages = [
    { role: 'user', content: 'msg1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'msg2' },
    { role: 'user', content: 'msg3' },
  ]

  function enableCompaction() {
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        chat: {
          maxTokens: 4096,
          conversationLogging: false,
          compaction: { enabled: true, reserveTokens: 8000, keepRecentTokens: 16000 },
        },
      }),
    )
  }

  it('compaction 启用 → 简化消息转 AgentMessage 压缩,压缩结果转回简化格式发送', async () => {
    enableCompaction()
    piMocks.compactAgentMessages.mockResolvedValue([
      { role: 'user', content: '[压缩摘要] 之前对话…' },
      { role: 'user', content: '最近的问题' },
    ])
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))

    // 简化格式 → AgentMessage: 全部 user role + 原文,带 apiKey 与 abort signal
    const compactArgs = piMocks.compactAgentMessages.mock.calls[0] as unknown[]
    const agentMsgs = compactArgs[0] as Array<{ role: string; content: string }>
    expect(agentMsgs.map((m) => [m.role, m.content])).toEqual([
      ['user', 'msg1'],
      ['user', 'a1'],
      ['user', 'msg2'],
      ['user', 'msg3'],
    ])
    expect(compactArgs[3]).toBe('sk-test')
    expect(compactArgs[4]).toBeInstanceOf(AbortSignal)
    // reserveTokens 自适应: computeAdaptiveReserve(8000, 128000) = 8000
    expect(piMocks.computeAdaptiveReserve).toHaveBeenCalledWith(8000, 128000)
    expect(compactArgs[2]).toEqual({ enabled: true, reserveTokens: 8000, keepRecentTokens: 16000 })

    // AgentMessage(压缩结果) → 简化格式 → pi-ai UserMessage
    const { context } = streamCall()
    expect(context.messages).toHaveLength(2)
    expect(context.messages[0]).toMatchObject({ role: 'user', content: '[压缩摘要] 之前对话…' })
    expect(context.messages[1]).toMatchObject({ role: 'user', content: '最近的问题' })
  })

  it('压缩结果 content 为 text blocks 数组 → 各 text 块按换行拼接', async () => {
    enableCompaction()
    piMocks.compactAgentMessages.mockResolvedValue([
      {
        role: 'user',
        content: [
          { type: 'text', text: '第一段' },
          { type: 'text', text: '第二段' },
          { type: 'image' }, // 非 text 块被过滤
        ],
      },
    ])
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))
    const { context } = streamCall()
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]).toMatchObject({ role: 'user', content: '第一段\n第二段' })
  })

  it('压缩结果 content 非 string/array → String() 兜底', async () => {
    enableCompaction()
    piMocks.compactAgentMessages.mockResolvedValue([{ role: 'user', content: undefined }])
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))
    const { context } = streamCall()
    expect(context.messages[0]).toMatchObject({ role: 'user', content: '' })
  })

  it('LLM 摘要失败 → 降级到字符串截断(compactChatMessagesSimple)', async () => {
    enableCompaction()
    piMocks.compactAgentMessages.mockRejectedValue(new Error('LLM summary failed'))
    piMocks.compactChatMessagesSimple.mockReturnValue([{ role: 'user', content: '截断摘要' }])
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))

    // 降级函数收到 (原消息, contextWindow, adaptiveReserve, keepRecentTokens)
    expect(piMocks.compactChatMessagesSimple).toHaveBeenCalledWith(fourMessages, 128000, 8000, 16000)
    const { context } = streamCall()
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]).toMatchObject({ role: 'user', content: '截断摘要' })
  })

  it('压缩结果长度未减少 → 不应用压缩,原消息直发', async () => {
    enableCompaction()
    piMocks.compactAgentMessages.mockResolvedValue(
      fourMessages.map((m) => ({ role: 'user', content: m.content })),
    )
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))
    const { context } = streamCall()
    // 原消息直发: user 消息保持 UserMessage,assistant 消息构造 AssistantMessage(text blocks)
    expect(context.messages).toHaveLength(4)
    expect(context.messages[0]).toMatchObject({ role: 'user', content: 'msg1' })
    expect(context.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'a1' }],
    })
    expect(context.messages[2]).toMatchObject({ role: 'user', content: 'msg2' })
    expect(context.messages[3]).toMatchObject({ role: 'user', content: 'msg3' })
  })

  it('compaction 未启用 → 不调用压缩', async () => {
    await collect(new ChatStreamRunner().chatStream(chatParams({ messages: fourMessages })))
    expect(piMocks.compactAgentMessages).not.toHaveBeenCalled()
    expect(piMocks.compactChatMessagesSimple).not.toHaveBeenCalled()
  })

  it('assistant 历史消息 → 构造最小合法 pi-ai AssistantMessage', async () => {
    await collect(
      new ChatStreamRunner().chatStream(
        chatParams({
          messages: [
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: '旧回答' },
            { role: 'user', content: 'q2' },
          ],
        }),
      ),
    )
    const { context } = streamCall()
    expect(context.messages).toHaveLength(3)
    // user 消息 → UserMessage
    expect(context.messages[0]).toMatchObject({ role: 'user', content: 'q1' })
    expect(context.messages[2]).toMatchObject({ role: 'user', content: 'q2' })
    // assistant 消息 → AssistantMessage(带 usage/stopReason 元数据)
    const assistant = context.messages[1] as Record<string, unknown>
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '旧回答' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'test-model',
      stopReason: 'stop',
    })
    expect(assistant.usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    })
  })

  it('非 user/assistant 角色(如 system/tool)在构造 Context 前被过滤', async () => {
    await collect(
      new ChatStreamRunner().chatStream(
        chatParams({
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'q1' },
            { role: 'tool', content: 'tool result' },
          ],
        }),
      ),
    )
    const { context } = streamCall()
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]).toMatchObject({ role: 'user', content: 'q1' })
  })
})
// ===========================================================
// abort 中途取消(Critical 4.1: 并发隔离, 新流 abort 旧流)
// ===========================================================

describe('ChatStreamRunner — abort 中途取消', () => {
  it('新 chatStream 启动 → 旧流被 abort 且产出 error 事件, 新流不受影响', async () => {
    const runner = new ChatStreamRunner()
    piMocks.streamSimple
      .mockImplementationOnce((_m: unknown, _c: unknown, opts: { signal: AbortSignal }) =>
        hangStream(opts.signal),
      )
      .mockImplementationOnce(() => evtStream([T.textDelta('新流正常'), T.done()]))

    // 流 1: 挂起等待首事件
    const events1: StreamEvent[] = []
    const consumer1 = (async () => {
      for await (const e of runner.chatStream(
        chatParams({ messages: [{ role: 'user', content: '第一个问题' }] }),
      ))
        events1.push(e)
    })()
    await vi.waitFor(() => expect(piMocks.streamSimple).toHaveBeenCalledTimes(1))

    // 流 2 启动 → 内部 abort 流 1 的 controller
    const events2 = await collect(
      runner.chatStream(chatParams({ messages: [{ role: 'user', content: '第二个问题' }] })),
    )
    await consumer1

    // 流 1: start + abort 转成的 error(非 retryable)
    expect(typesOf(events1)).toEqual(['start', 'error'])
    const err1 = events1[1] as Extract<StreamEvent, { type: 'error' }>
    expect(err1.retryable).toBe(false)
    expect(err1.message).toMatch(/abort/i)
    // 流 2: 正常完成
    expect(typesOf(events2)).toEqual(['start', 'text_delta', 'done'])
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('abort 后即使错误消息可重试也不自动重试(canAutoRetry 的 aborted 条件)', async () => {
    const runner = new ChatStreamRunner()
    // 流 1: 挂起,abort 时抛"可重试"错误(消息含 timeout)
    piMocks.streamSimple
      .mockImplementationOnce(
        (_m: unknown, _c: unknown, opts: { signal: AbortSignal }) =>
          (async function* () {
            await new Promise<never>((_, reject) => {
              opts.signal.addEventListener(
                'abort',
                () => reject(new Error('network timeout after abort')),
                { once: true },
              )
            })
          })(),
      )
      .mockImplementationOnce(() => evtStream([T.done()]))

    const events1: StreamEvent[] = []
    const consumer1 = (async () => {
      for await (const e of runner.chatStream(chatParams())) events1.push(e)
    })()
    await vi.waitFor(() => expect(piMocks.streamSimple).toHaveBeenCalledTimes(1))

    await collect(runner.chatStream(chatParams()))
    await consumer1

    // 流 1: 无 retry 事件,直接 error;retryable=true(消息含 timeout)但已被 abort
    expect(typesOf(events1)).toEqual(['start', 'error'])
    const err1 = events1[1] as Extract<StreamEvent, { type: 'error' }>
    expect(err1.message).toBe('network timeout after abort')
    expect(err1.retryable).toBe(true)
    expect(err1.retry).toMatchObject({ shouldRetry: true })
    // 流 1 自身未重建 stream(总调用 = 流1一次 + 流2一次)
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================
// 首字节超时与自动重试(fake timers)
// ===========================================================

describe('ChatStreamRunner — 首字节超时与重试', () => {
  it('首字节超时 → yield retry 事件并重建流成功', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0) // 消除退避 jitter
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        models: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 50, providerTimeoutMs: 100 } },
      }),
    )
    piMocks.streamSimple
      .mockImplementationOnce((_m: unknown, _c: unknown, opts: { signal: AbortSignal }) =>
        hangStream(opts.signal),
      )
      .mockImplementationOnce(() => evtStream([T.textStart(), T.textDelta('恢复'), T.done()]))

    const events: StreamEvent[] = []
    const consumer = (async () => {
      for await (const e of new ChatStreamRunner().chatStream(chatParams())) events.push(e)
    })()

    // 建立流 1(provider 挂起, 首字节计时器已启动)
    await vi.advanceTimersByTimeAsync(0)
    expect(typesOf(events)).toEqual(['start'])
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(1)

    // 推进 100ms → 首字节超时 → abort → retry 事件 → 退避挂起
    await vi.advanceTimersByTimeAsync(100)
    expect(typesOf(events)).toEqual(['start', 'retry'])
    const retryEvt = events[1] as Extract<StreamEvent, { type: 'retry' }>
    expect(retryEvt.attempt).toBe(1)
    expect(retryEvt.maxRetries).toBe(2)
    expect(retryEvt.delayMs).toBe(50)
    expect(retryEvt.reason).toMatch(/Provider connection timeout \(100ms/)

    // 退避结束 → 重建流 → 正常消费完毕
    await vi.advanceTimersByTimeAsync(50)
    await consumer
    expect(typesOf(events)).toEqual(['start', 'retry', 'text_start', 'text_delta', 'done'])
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('首字节超时重试后仍挂起 → 重试耗尽产出 error 事件', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        models: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 50, providerTimeoutMs: 100 } },
      }),
    )
    piMocks.streamSimple.mockImplementation(
      (_m: unknown, _c: unknown, opts: { signal: AbortSignal }) => hangStream(opts.signal),
    )

    const events: StreamEvent[] = []
    const consumer = (async () => {
      for await (const e of new ChatStreamRunner().chatStream(chatParams())) events.push(e)
    })()

    await vi.advanceTimersByTimeAsync(0) // 流 1 建立
    await vi.advanceTimersByTimeAsync(100) // 超时 1 → retry(attempt=1) → 退避
    await vi.advanceTimersByTimeAsync(50) // 流 2 建立挂起
    await vi.advanceTimersByTimeAsync(100) // 超时 2 → attempt(1) 不小于 maxRetries(1) → error
    await consumer

    expect(typesOf(events)).toEqual(['start', 'retry', 'error'])
    const errEvt = events[2] as Extract<StreamEvent, { type: 'error' }>
    expect(errEvt.message).toMatch(/Provider connection timeout/)
    expect(errEvt.retryable).toBe(true)
    expect(errEvt.retry).toMatchObject({ enabled: true, maxRetries: 1, shouldRetry: true })
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('网络错误重试耗尽 → 1 次 retry 后 error', async () => {
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        models: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 10, providerTimeoutMs: 60000 } },
      }),
    )
    piMocks.streamSimple.mockImplementation(() =>
      (async function* () {
        throw new Error('network error: ECONNRESET')
      })(),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'retry', 'error'])
    const retryEvt = events[1] as Extract<StreamEvent, { type: 'retry' }>
    expect(retryEvt).toMatchObject({
      attempt: 1,
      maxRetries: 1,
      reason: 'network error: ECONNRESET',
    })
    const errEvt = events[2] as Extract<StreamEvent, { type: 'error' }>
    expect(errEvt).toMatchObject({ message: 'network error: ECONNRESET', retryable: true })
    expect(errEvt.retry).toMatchObject({ shouldRetry: true })
    // 初次 + 重试共 2 次调用
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('重试中途恢复 → 退避后成功(第二次调用返回正常流)', async () => {
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        models: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 10, providerTimeoutMs: 60000 } },
      }),
    )
    piMocks.streamSimple
      .mockImplementationOnce(() =>
        (async function* () {
          throw new Error('503 Service Unavailable')
        })(),
      )
      .mockImplementationOnce(() => evtStream([T.textDelta('recovered'), T.done()]))
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'retry', 'text_delta', 'done'])
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('retry.enabled=false → 不重试,直接 error', async () => {
    piMocks.settingsGet.mockReturnValue(
      defaultSettings({
        models: { retry: { enabled: false, maxRetries: 3, baseDelayMs: 10, providerTimeoutMs: 60000 } },
      }),
    )
    piMocks.streamSimple.mockImplementation(() =>
      (async function* () {
        throw new Error('network error')
      })(),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'error'])
    const errEvt = events[1] as Extract<StreamEvent, { type: 'error' }>
    expect(errEvt.retryable).toBe(true)
    expect(errEvt.retry).toMatchObject({ enabled: false, shouldRetry: false })
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('已向用户输出 token 后出错 → 不再重试(避免重复输出)', async () => {
    piMocks.streamSimple.mockImplementationOnce(() =>
      (async function* () {
        yield T.textStart()
        yield T.textDelta('partial')
        throw new Error('502 Bad Gateway')
      })(),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'text_start', 'text_delta', 'error'])
    const errEvt = events[3] as Extract<StreamEvent, { type: 'error' }>
    expect(errEvt.retryable).toBe(true) // 502 属可重试错误
    expect(events.some((e) => e.type === 'retry')).toBe(false)
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('不可重试错误(如鉴权失败) → 直接 error 无 retry 事件', async () => {
    piMocks.streamSimple.mockImplementation(() =>
      (async function* () {
        throw new Error('401 Unauthorized')
      })(),
    )
    const events = await collect(new ChatStreamRunner().chatStream(chatParams()))
    expect(typesOf(events)).toEqual(['start', 'error'])
    const errEvt = events[1] as Extract<StreamEvent, { type: 'error' }>
    expect(errEvt).toMatchObject({ message: '401 Unauthorized', retryable: false })
    expect(piMocks.streamSimple).toHaveBeenCalledTimes(1)
  })
})