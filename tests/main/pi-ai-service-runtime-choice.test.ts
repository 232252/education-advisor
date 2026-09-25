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
  fingerprint: 'fp-a',
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

// pi chat streaming removed — always dsh now

// resolveModel 只提供档位表这一个事实来源：让「档位有没有落到 initialize」可判定
vi.mock('../../src/main/services/pi-ai/model-utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveModel: () => ({ thinkingLevelMap: { high: 'high', low: 'low', medium: null } }),
  }
})

// 路由级配置/凭据的指纹由 provider-patch 提供，这里给一个可变的假值，
// 这样「改了 key 或 Base URL 会不会换子进程」可判定
vi.mock('../../src/main/services/dsh/provider-patch', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, dshRouteFingerprint: () => state.fingerprint }
})

vi.mock('../../src/main/services/dsh/runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  // routeKey 与 dshPinnedKey 必须逐字同规则 —— 手写镜像迟早和真实现分叉，
  // 于是「同路由复用」的用例会假绿或假红。直接复用真函数，杜绝漂移。
  const pinnedKey = actual.dshPinnedKey as (o: Record<string, unknown>) => string
  return {
    ...actual,
    createDshRuntime: (opts: {
      provider?: string
      model?: string
      maxTokens?: number
      reasoningEffort?: string
      configFingerprint?: string
    }) => {
      state.dshBuilt++
      state.dshOpts = opts
      return {
        routeKey: pinnedKey({ ...opts }),
        async *chatStream() {
          yield DONE
        },
        async disposeWhenIdle() {
          state.retired++
        },
      }
    },
  }
})

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
    state.fingerprint = 'fp-a'
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

  it("显式 'pi' 也会走 dsh 后端（Pi 运行时已移除）", async () => {
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request()))).toEqual([DONE])
    expect(state.dshBuilt).toBe(1)
  })

  it("agentRuntime='dsh' 时用首个请求的 provider/model 建 DshRuntime", async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))).toEqual([DONE])
    expect(state.dshBuilt).toBe(1)
    expect(state.piBuilt).toBe(0)
    expect(state.dshOpts).toEqual({
      provider: 'kimi',
      model: 'kimi-k2',
      configFingerprint: 'fp-a',
    })
  })

  it('换 provider/model 即换子进程，旧的等空闲后关停', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    await drain(piAIService.chatStream(request('deepseek', 'other')))
    expect(state.dshBuilt).toBe(2)
    expect(state.dshOpts).toEqual({
      provider: 'deepseek-official',
      model: 'other',
      configFingerprint: 'fp-a',
    })
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

  it('换了 key 或 Base URL（指纹变化）就换新子进程，旧的等空闲关停', async () => {
    // dsh 的凭据与路由都是 spawn 时经 env/patch 定死的，沿用旧进程＝继续用旧 key
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    state.fingerprint = 'fp-b'
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    expect(state.dshBuilt).toBe(2)
    expect(state.retired).toBe(1)
    expect(state.dshOpts).toMatchObject({
      provider: 'kimi',
      model: 'kimi-k2',
      configFingerprint: 'fp-b',
    })
  })

  it('dsh 路由改名只作用于子进程，请求里的 pi id 不被改写', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('deepseek', 'deepseek-v4-flash')))
    // dsh-base 的 llm-deepseek 行只认 deepseek-official（route.ts 的内建别名）
    expect(state.dshOpts).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      configFingerprint: 'fp-a',
    })
  })

  it('设置读取抛错时仍走 dsh 并告警', async () => {
    state.throwOnRead = true
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    expect(await drain(piAIService.chatStream(request()))).toEqual([DONE])
    expect(state.dshBuilt).toBe(1)
    expect(console.warn).toHaveBeenCalled()
  })

  it('对话链路不挂 MCP 端点（工具面与 pi 路径一样为空）', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream(request('kimi', 'kimi-k2')))
    expect(state.dshOpts).not.toHaveProperty('patches')
  })

  it('界面上选的推理档位随 initialize 定死进子进程；模型不支持的档省略', async () => {
    state.backend = 'dsh'
    const { piAIService } = await import('../../src/main/services/pi-ai-service')
    await drain(piAIService.chatStream({ ...request('deepseek', 'x'), thinking: 'high' }))
    expect((state.dshOpts as { reasoningEffort?: string }).reasoningEffort).toBe('high')
    // 档位不同＝定死值不同＝必须换子进程，否则用户换了档却还在打旧档
    await drain(piAIService.chatStream({ ...request('deepseek', 'x'), thinking: 'low' }))
    expect(state.dshBuilt).toBe(2)
    expect((state.dshOpts as { reasoningEffort?: string }).reasoningEffort).toBe('low')
    // 该模型目录里这一档显式为 null ⇒ 不发给 dsh（发出去整轮会被打挂）
    await drain(piAIService.chatStream({ ...request('deepseek', 'x'), thinking: 'medium' }))
    expect((state.dshOpts as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
  })

})
