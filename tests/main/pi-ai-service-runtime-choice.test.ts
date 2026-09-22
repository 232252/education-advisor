// =============================================================
// settings.models.agentRuntime 后端选择测试
// 覆盖: (a) 缺省走 dsh（'pi' 为显式回退项）
//       (b) 'dsh' 时按首个请求的 provider/model 懒建 DshRuntime
//       (c) 设置读取抛错时回落 pi，不打断对话
//       (d) 换 provider/model 即换子进程（SDK 的路由是进程级定死的）
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  backend: 'pi' as 'pi' | 'dsh' | undefined,
  throwOnRead: false,
  piBuilt: 0,
  dshBuilt: 0,
  retired: 0,
  dshOpts: null as unknown,
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => {
      if (state.throwOnRead) throw new Error('settings not ready')
      return { models: { agentRuntime: state.backend } }
    },
  },
}))

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: {
    getApiKey: () => undefined,
    setApiKey: () => {},
    deleteApiKey: () => {},
  },
}))

const DONE = {
  type: 'done',
  cost: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
} as const

vi.mock('../../src/main/services/pi-ai/streaming', () => ({
  ChatStreamRunner: class {
    constructor() {
      state.piBuilt++
    }
    async *chatStream() {
      yield DONE
    }
  },
}))

vi.mock('../../src/main/services/dsh/runtime', () => ({
  // 与 dsh/runtime 的 dshPinnedKey 同规则（mock 必须一起提供，否则上层 import 不到）
  dshPinnedKey: (o: { provider?: string; model?: string; maxTokens?: number; reasoningEffort?: string }) =>
    [o.provider ?? '', o.model ?? '', o.maxTokens ?? '', o.reasoningEffort ?? ''].join('\u0000'),
  // 生产入口是 createDshRuntime（它负责附上关掉 harness 自带工具 + 声明凭据路由的 patch）
  createDshRuntime: (opts: { provider?: string; model?: string; maxTokens?: number }) => {
    state.dshBuilt++
    state.dshOpts = opts
    return {
      // 与 dshPinnedKey 同规则：定死的四个值任一变化即换子进程
      routeKey: [opts.provider ?? '', opts.model ?? '', opts.maxTokens ?? '', ''].join('\u0000'),
      async *chatStream() {
        yield DONE
      },
      async disposeWhenIdle() {
        state.retired++
      },
    }
  },
}))

const request = (providerId = 'deepseek', modelId = 'deepseek-v4-flash') => ({
  providerId,
  modelId,
  messages: [{ role: 'user', content: 'hi' }],
})

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('piAIService 流式后端选择', () => {
  beforeEach(() => {
    // piAIService 是模块级单例，runner 字段会跨用例残留 → 每例重新求值模块
    vi.resetModules()
    state.backend = 'pi'
    state.throwOnRead = false
    state.piBuilt = 0
    state.dshBuilt = 0
    state.retired = 0
    state.dshOpts = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('无 agentRuntime 键时按缺省走 dsh（pi 只在显式指定时回退）', async () => {
    state.backend = undefined
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request()))).toEqual([DONE])
    expect(state.dshBuilt).toBe(1)
    expect(state.piBuilt).toBe(0)
  })

  it("显式 'pi' 才走内置运行时，不构造 dsh 子进程", async () => {
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request()))).toEqual([DONE])
    expect(state.piBuilt).toBe(1)
    expect(state.dshBuilt).toBe(0)
  })

  it("agentRuntime='dsh' 时用首个请求的 provider/model 建 DshRuntime", async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))).toEqual([DONE])
    expect(state.dshBuilt).toBe(1)
    expect(state.piBuilt).toBe(0)
    expect(state.dshOpts).toEqual({ provider: 'kimi', model: 'kimi-k2' })
  })

  it('换 provider/model 即换子进程，旧的等空闲后关停', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    await drain(piAIService.chatStream(request('deepseek', 'other')))
    expect(state.dshBuilt).toBe(2)
    expect(state.dshOpts).toEqual({ provider: 'deepseek-official', model: 'other' })
    expect(state.retired).toBe(1)
  })

  it('同一路由的连续请求复用一个子进程', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    expect(state.dshBuilt).toBe(1)
    expect(state.retired).toBe(0)
  })

  it('dsh 路由改名只作用于子进程，请求里的 pi id 不被改写', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('deepseek', 'deepseek-v4-flash')))
    // dsh-base 的 llm-deepseek 行只认 deepseek-official（route.ts 的内建别名）
    expect(state.dshOpts).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('设置读取抛错时回落 pi 并告警', async () => {
    state.throwOnRead = true
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request()))).toEqual([DONE])
    expect(state.piBuilt).toBe(1)
    expect(state.dshBuilt).toBe(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it('对话链路不挂 MCP 端点（工具面与 pi 路径一样为空）', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    expect(state.dshOpts).not.toHaveProperty('patches')
  })
})
