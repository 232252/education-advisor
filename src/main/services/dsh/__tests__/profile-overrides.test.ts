// =============================================================
// dsh 路由级覆盖映射测试
//
// 这层存在的理由是一个静默错行为：pi 后端下用户在模型页填的 Base URL 由主进程
// 内存里的 Model.baseUrl 生效，dsh 后端下它必须写进 patch 才有人认 —— 不写就是
// 「界面显示自建网关、请求实际打到厂商官方端点」，拿用户的 key 去官方计费。
// 所以这里把「什么时候转发、什么时候绝不瞎猜」钉住。
// =============================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DshModelsSettingsSlice,
  dshRouteBaseURL,
  dshRouteModelEntry,
  dshRouteProfileOverrides,
  providersWithCustomModels,
} from '../profile-overrides'

const models = (over: Partial<DshModelsSettingsSlice> = {}): DshModelsSettingsSlice => ({
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000, providerTimeoutMs: 60000 },
  cacheRetention: 'short',
  customModels: {},
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dshRouteBaseURL', () => {
  it('该 provider 的自定义模型只有一个不重复 Base URL 时转发它', () => {
    const s = models({
      customModels: {
        openai: [
          { baseUrl: '  https://gateway.school.local/v1  ' },
          { baseUrl: 'https://gateway.school.local/v1' },
        ],
      },
    })
    expect(dshRouteBaseURL(s, 'openai')).toBe('https://gateway.school.local/v1')
  })

  it('多个不同 Base URL 时一个都不转发（dsh 的路由只有一个 baseURL，瞎猜更危险）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = models({
      customModels: {
        openai: [{ baseUrl: 'https://a.example/v1' }, { baseUrl: 'https://b.example/v1' }],
      },
    })
    expect(dshRouteBaseURL(s, 'openai')).toBeUndefined()
    // 不能静默：要么写对，要么把「为什么没生效」说清
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /2 different custom Base URLs/,
    )
  })

  it('自定义模型没填 Base URL / 没有该 provider / 空串都算没配', () => {
    expect(dshRouteBaseURL(models(), 'openai')).toBeUndefined()
    expect(
      dshRouteBaseURL(models({ customModels: { openai: [{ baseUrl: '' }] } }), 'openai'),
    ).toBeUndefined()
    expect(
      dshRouteBaseURL(models({ customModels: { kimi: [{ baseUrl: 'https://x/v1' }] } }), 'openai'),
    ).toBeUndefined()
    expect(dshRouteBaseURL(undefined, 'openai')).toBeUndefined()
  })
})

describe('dshRouteProfileOverrides', () => {
  it('读不到 settings 时一段都不写（保持只带 apiKeyEnv 的旧 patch 形态）', () => {
    expect(dshRouteProfileOverrides(undefined, 'kimi')).toEqual({})
    expect(dshRouteProfileOverrides(null, 'kimi')).toEqual({})
  })

  it('retry.* 映射成 dsh 的 retryPolicy + timeoutMs', () => {
    expect(dshRouteProfileOverrides(models(), 'kimi')).toEqual({
      timeoutMs: 60000,
      cacheRetention: 'short',
      retryPolicy: { mode: 'normal', maxRetries: 3, backoff: { initialDelayMs: 1000 } },
    })
  })

  it('用户把重试关掉 → maxRetries 0，而不是继续按 dsh 默认的 5 次重试', () => {
    const s = models({
      retry: { enabled: false, maxRetries: 9, baseDelayMs: 500, providerTimeoutMs: 30000 },
    })
    expect(dshRouteProfileOverrides(s, 'kimi').retryPolicy).toEqual({
      mode: 'normal',
      maxRetries: 0,
      backoff: { initialDelayMs: 500 },
    })
  })

  it('settings 被手改成错误类型时逐项回落默认值，不抛错也不写坏配置', () => {
    const broken = {
      retry: {
        enabled: 'yes',
        maxRetries: -2,
        baseDelayMs: 0,
        providerTimeoutMs: Number.NaN,
      },
      cacheRetention: 'forever',
    } as unknown as DshModelsSettingsSlice
    expect(dshRouteProfileOverrides(broken, 'kimi')).toEqual({
      cacheRetention: undefined,
      retryPolicy: { mode: 'normal', maxRetries: 3, backoff: { initialDelayMs: 1000 } },
      timeoutMs: undefined,
    })
    expect(dshRouteProfileOverrides(broken, 'kimi').cacheRetention).toBeUndefined()
    expect(dshRouteProfileOverrides(broken, 'kimi').timeoutMs).toBeUndefined()
  })

  it('只有 retry 段缺失时仍给出可解析的 retryPolicy（enabled 缺省按开）', () => {
    const s: DshModelsSettingsSlice = {}
    expect(dshRouteProfileOverrides(s, 'kimi')).toEqual({
      retryPolicy: { mode: 'normal', maxRetries: 3, backoff: { initialDelayMs: 1000 } },
    })
  })

  it('cacheRetention 只认 dsh 的三个取值', () => {
    for (const v of ['none', 'short', 'long'] as const) {
      expect(dshRouteProfileOverrides({ cacheRetention: v }, 'kimi').cacheRetention).toBe(v)
    }
    expect(
      dshRouteProfileOverrides({ cacheRetention: 'always' }, 'kimi').cacheRetention,
    ).toBeUndefined()
  })
})

describe('providersWithCustomModels', () => {
  it('只列出真有自定义模型的 provider', () => {
    expect(
      providersWithCustomModels({
        customModels: { openai: [{ baseUrl: 'x' }], kimi: [], deepseek: [{}] },
      }),
    ).toEqual(['openai', 'deepseek'])
    expect(providersWithCustomModels({})).toEqual([])
    expect(providersWithCustomModels(undefined)).toEqual([])
  })
})

describe('dshRouteModelEntry（钉住的路由要自带模型条目）', () => {
  it('目录字段按 dsh 的名字映射：maxTokens / input / reasoningEfforts', () => {
    expect(
      dshRouteModelEntry({
        id: 'kimi-k2',
        name: 'Kimi K2',
        contextWindow: 200000,
        maxTokens: 8192,
        input: ['text', 'image'],
        thinkingLevelMap: { high: 'high', low: 'low', medium: null },
      }),
    ).toEqual({
      id: 'kimi-k2',
      name: 'Kimi K2',
      contextWindow: 200000,
      maxTokens: 8192,
      input: ['text', 'image'],
      // 目录里的 null = 该模型不走这档 ⇒ dsh 侧的正确写法是不写这一档
      reasoningEfforts: { high: 'high', low: 'low' },
    })
  })

  it('null 只有 off 一档可以带（真子进程实测：medium: null 会让整条路由被拒）', () => {
    expect(
      dshRouteModelEntry({ id: 'm', thinkingLevelMap: { off: null, medium: null, low: 'low' } }),
    ).toEqual({ id: 'm', reasoningEfforts: { off: null, low: 'low' } })
  })

  it('只发 dsh 认得的档位名，目录里的其它键不带上（发错值是整轮失败）', () => {
    const entry = dshRouteModelEntry({
      id: 'm',
      thinkingLevelMap: { ultra: 'ultra', low: 'low', bogus: 'x' },
    })
    expect(entry?.reasoningEfforts).toEqual({ low: 'low' })
  })

  it('空 id / 非正数 / 非模态值都不产出坏字段', () => {
    expect(dshRouteModelEntry(undefined)).toBeUndefined()
    expect(dshRouteModelEntry({ id: '' })).toBeUndefined()
    expect(
      dshRouteModelEntry({
        id: 'm',
        contextWindow: 0,
        maxTokens: Number.NaN,
        input: ['audio', 'image'],
      }),
    ).toEqual({ id: 'm', input: ['image'] })
  })

  it('没有任何档位可发时省略 reasoningEfforts（而不是发 false）', () => {
    expect(dshRouteModelEntry({ id: 'm', thinkingLevelMap: { bogus: 'x' } })).toEqual({ id: 'm' })
    expect(dshRouteModelEntry({ id: 'm' })).toEqual({ id: 'm' })
  })
})
