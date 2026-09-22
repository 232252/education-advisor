// =============================================================
// 批改调用双后端出口 llm-call 测试
// 覆盖: (a) pi 路径逐字透传 completeSimple 的入参与返回
//       (b) dsh 路径合成 AssistantMessage（usage/cost/stopReason 口径）
//       (c) signal / 多消息 在 dsh 下明确抛错（不静默丢功能）
//       (d) 换模型即重建 dsh 运行时；reset 可丢弃
//       (e) 设置读取抛错时回落 pi
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  backend: 'pi' as 'pi' | 'dsh' | undefined,
  throwOnRead: false,
  piCalls: [] as unknown[],
  dshBuilt: 0,
  oneShotCalls: [] as unknown[],
  oneShotResult: {
    text: '答案',
    usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 1, cacheWriteTokens: 2 },
  } as {
    text: string
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
    stopReason?: 'aborted'
  },
}))

const PI_SENTINEL = { role: 'assistant', content: [], marker: 'from-pi' } as never

vi.mock('@earendil-works/pi-ai/compat', () => ({
  completeSimple: (...args: unknown[]) => {
    state.piCalls.push(args)
    return Promise.resolve(PI_SENTINEL)
  },
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => {
      if (state.throwOnRead) throw new Error('settings not ready')
      return { models: { agentRuntime: state.backend } }
    },
  },
}))

vi.mock('../../src/main/services/dsh/runtime', () => ({
  // 生产入口是 createDshRuntime：关掉 harness 自带工具那层 patch 由它负责附上
  createDshRuntime: (opts: unknown) => {
    state.dshBuilt++
    state.dshOpts = opts
    return {
      async *chatStream() {
        /* 由 one-shot 的 mock 接管 */
      },
      async dispose() {},
    }
  },
}))

vi.mock('../../src/main/services/dsh/one-shot', () => ({
  completeSimpleViaDsh: (params: unknown) => {
    state.oneShotCalls.push(params)
    return Promise.resolve(state.oneShotResult)
  },
}))

const MODEL = {
  id: 'deepseek-v4-flash',
  api: 'openai-completions',
  provider: 'deepseek',
  maxTokens: 8192,
} as never

const userMessage = (text: string) =>
  ({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 }) as never

async function load() {
  vi.resetModules()
  return import('../../src/main/services/grading/llm-call')
}

const call = (mod: Awaited<ReturnType<typeof load>>, options?: Record<string, unknown>) =>
  mod.completeGradingCall(
    MODEL,
    { systemPrompt: '批改量规', messages: [userMessage('这张卷子')] },
    { apiKey: 'k', maxTokens: 1024, ...options },
  )

beforeEach(() => {
  state.backend = 'pi'
  state.throwOnRead = false
  state.piCalls = []
  state.dshBuilt = 0
  state.oneShotCalls = []
  state.oneShotResult = {
    text: '答案',
    usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 1, cacheWriteTokens: 2 },
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('completeGradingCall — pi 路径', () => {
  it('缺省原样透传三个参数并返回 completeSimple 的结果', async () => {
    const mod = await load()
    const context = { systemPrompt: '批改量规', messages: [userMessage('这张卷子')] }
    const out = await mod.completeGradingCall(MODEL, context, { apiKey: 'k', maxTokens: 1024 })
    expect(out).toBe(PI_SENTINEL)
    expect(state.piCalls).toEqual([[MODEL, context, { apiKey: 'k', maxTokens: 1024 }]])
    expect(state.dshBuilt).toBe(0)
  })

  it('signal/cacheRetention/sessionId 原样带到 pi', async () => {
    const mod = await load()
    const signal = new AbortController().signal
    await mod.completeGradingCall(
      MODEL,
      { systemPrompt: 's', messages: [userMessage('x')] },
      { apiKey: 'k', maxTokens: 256, signal, cacheRetention: 'short', sessionId: 'quad:1' },
    )
    expect(state.piCalls[0]?.[2]).toEqual({
      apiKey: 'k',
      maxTokens: 256,
      signal,
      cacheRetention: 'short',
      sessionId: 'quad:1',
    })
  })

  it('设置读取抛错时回落 pi 并告警', async () => {
    state.throwOnRead = true
    const mod = await load()
    expect(await call(mod)).toBe(PI_SENTINEL)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('completeGradingCall — dsh 路径', () => {
  beforeEach(() => {
    state.backend = 'dsh'
  })

  it('合成 AssistantMessage：文本/usage/cost 与 stopReason 口径固定', async () => {
    const mod = await load()
    const out = await call(mod)
    expect(out).toEqual({
      role: 'assistant',
      timestamp: expect.any(Number),
      content: [{ type: 'text', text: '答案' }],
      api: 'openai-completions',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      usage: {
        input: 4,
        output: 6,
        cacheRead: 1,
        cacheWrite: 2,
        totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
    })
  })

  it('aborted 归一化成 stopReason=aborted，供管线抛「已中止」', async () => {
    state.oneShotResult = { ...state.oneShotResult, stopReason: 'aborted' }
    const mod = await load()
    expect((await call(mod)).stopReason).toBe('aborted')
  })

  it('空文本时 content 为空数组（不塞空 block）', async () => {
    state.oneShotResult = { ...state.oneShotResult, text: '' }
    const mod = await load()
    expect((await call(mod)).content).toEqual([])
  })

  it('把 systemPrompt 与消息内容交给 one-shot', async () => {
    const mod = await load()
    await call(mod)
    expect(state.oneShotCalls[0]).toMatchObject({
      // 交给 dsh 的是映射后的路由名（pi 的 'deepseek' 在 dsh 侧叫 deepseek-official）；
      // 而返回的 AssistantMessage 仍记 pi 的 provider，见上一用例
      providerId: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
      systemPrompt: '批改量规',
      maxTokens: 1024,
      content: [{ type: 'text', text: '这张卷子' }],
    })
  })

  it('dsh 下 signal 透传给 one-shot 并带上 cancel（关停子进程那侧）', async () => {
    state.backend = 'dsh'
    const mod = await load()
    const controller = new AbortController()
    const msg = await call(mod, { signal: controller.signal })
    expect(msg.stopReason).toBe('stop')
    const passed = state.oneShotCalls[0] as { signal: AbortSignal; cancel: () => void }
    expect(passed.signal).toBe(controller.signal)
    expect(typeof passed.cancel).toBe('function')
    // cancel 要能把已关停的子进程从缓存里丢掉，否则下次调用握手到一个死进程
    expect(() => passed.cancel()).not.toThrow()
    expect(state.dshBuilt).toBe(1)
    await call(mod, { signal: controller.signal })
    expect(state.dshBuilt).toBe(2)
  })

  it('dsh 下多条消息明确抛错', async () => {
    const mod = await load()
    await expect(
      mod.completeGradingCall(
        MODEL,
        { systemPrompt: 's', messages: [userMessage('一'), userMessage('二')] },
        { apiKey: 'k', maxTokens: 8 },
      ),
    ).rejects.toThrow(/单条 user 消息/)
  })

  it('同一模型复用运行时，换模型即重建', async () => {
    const mod = await load()
    await call(mod)
    await call(mod)
    expect(state.dshBuilt).toBe(1)
    await mod.completeGradingCall(
      { ...MODEL, id: 'other-model' } as never,
      { systemPrompt: 's', messages: [userMessage('x')] },
      { apiKey: 'k', maxTokens: 8 },
    )
    expect(state.dshBuilt).toBe(2)
  })

  it('resetGradingDshRuntime 后重新建立', async () => {
    const mod = await load()
    await call(mod)
    mod.resetGradingDshRuntime()
    await call(mod)
    expect(state.dshBuilt).toBe(2)
  })
})
