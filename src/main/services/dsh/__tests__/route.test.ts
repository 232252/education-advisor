// =============================================================
// dsh 模型路由映射（settings.models.dshRoutes）
//
// 覆盖: (a) 无映射时按 pi 的 provider id 直通
//       (b) 有映射时只换 provider，model id 保持
//       (c) 空串/纯空白映射视为未配置（不能让 initialize 拿到空 provider）
//       (d) 设置读不到时直通并告警
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  routes: undefined as Record<string, string> | undefined,
  customModels: undefined as Record<string, { baseUrl?: string }[]> | undefined,
  throwOnRead: false,
}))

vi.mock('../../settings-service', () => ({
  settingsService: {
    getSettings: () => {
      if (state.throwOnRead) throw new Error('settings not ready')
      return {
        models: { agentRuntime: 'dsh', dshRoutes: state.routes, customModels: state.customModels },
      }
    },
  },
}))

import { dshRouteFor } from '../route'
import { dshReasoningEffort } from '../route-names'

describe('dshReasoningEffort（app 档位 → dsh initialize 值）', () => {
  const MAP = { high: 'high', low: 'low', medium: null } as const
  it('模型支持的档位取其目录里的映射值', () => {
    expect(dshReasoningEffort(MAP, 'high')).toBe('high')
    expect(dshReasoningEffort({ high: 'xhigh' }, 'high')).toBe('xhigh')
  })
  it('off / 未给档位 / 目录显式 null ⇒ 省略字段而不是整轮打挂', () => {
    expect(dshReasoningEffort(MAP, 'off')).toBeUndefined()
    expect(dshReasoningEffort(MAP, undefined)).toBeUndefined()
    expect(dshReasoningEffort(MAP, 'medium')).toBeUndefined()
  })
  it('目录里查不到这一档同样省略（宁缺勿炸）', () => {
    expect(dshReasoningEffort(MAP, 'minimal')).toBeUndefined()
  })
  it('无目录信息（自定义模型）时按名字透传，没有依据否定它', () => {
    expect(dshReasoningEffort(undefined, 'high')).toBe('high')
  })
})
describe('dshRouteFor', () => {
  beforeEach(() => {
    state.routes = undefined
    state.customModels = undefined
    state.throwOnRead = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('没有映射也没有别名时用 pi 的 provider id 作为路由', () => {
    expect(dshRouteFor('kimi', 'kimi-k2')).toEqual({
      providerId: 'kimi',
      modelId: 'kimi-k2',
    })
  })

  it("内建别名：pi 的 'deepseek' → dsh 的 'deepseek-official'", () => {
    expect(dshRouteFor('deepseek', 'deepseek-v4-flash')).toEqual({
      providerId: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
    })
  })

  it('填了自建 Base URL 的 provider 不被内建别名拐走（内建行的 baseURL patch 覆盖不到）', () => {
    state.customModels = { deepseek: [{ baseUrl: 'https://mirror.school.internal/v1' }] }
    expect(dshRouteFor('deepseek', 'deepseek-v4-flash')).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    })
    // 用户显式改名仍然优先
    state.routes = { deepseek: 'official-direct' }
    expect(dshRouteFor('deepseek', 'm').providerId).toBe('official-direct')
    // 多个互不相同的 Base URL ⇒ 一条路由表达不了 ⇒ 不转发，也别假装走网关
    state.routes = undefined
    state.customModels = {
      deepseek: [{ baseUrl: 'https://a/v1' }, { baseUrl: 'https://b/v1' }],
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(dshRouteFor('deepseek', 'm').providerId).toBe('deepseek-official')
    expect(warn).toHaveBeenCalled()
  })

  it('映射只换 provider，model id 原样带过去', () => {
    state.routes = { deepseek: 'my-deepseek-gateway', kimi: 'kimi-cn' }
    expect(dshRouteFor('deepseek', 'deepseek-v4-flash')).toEqual({
      providerId: 'my-deepseek-gateway',
      modelId: 'deepseek-v4-flash',
    })
    // 显式配置能盖掉内建别名，也能改回直通
    state.routes = { deepseek: 'deepseek' }
    expect(dshRouteFor('deepseek', 'm').providerId).toBe('deepseek')
  })

  it('空串或纯空白的映射等于没配，退回内建别名而不是空 provider', () => {
    state.routes = { deepseek: '   ', openai: '' }
    expect(dshRouteFor('deepseek', 'm').providerId).toBe('deepseek-official')
    expect(dshRouteFor('openai', 'm').providerId).toBe('openai')
    state.routes = { deepseek: '  routed  ' }
    expect(dshRouteFor('deepseek', 'm').providerId).toBe('routed')
  })

  it('设置读不到时走内建别名并告警', () => {
    state.throwOnRead = true
    expect(dshRouteFor('deepseek', 'm')).toEqual({
      providerId: 'deepseek-official',
      modelId: 'm',
    })
    expect(dshRouteFor('kimi', 'm')).toEqual({ providerId: 'kimi', modelId: 'm' })
    expect(console.warn).toHaveBeenCalled()
  })
})
