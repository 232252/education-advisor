// =============================================================
// useProviderModelsCache — Provider 模型列表缓存 hook 测试
// 覆盖: ensureLoaded(缓存/inflight 双守卫)、refresh(强制刷新/失败 toast)、
//       loadAll(批量/部分失败)、clear、invalidateAndRefresh、getModels
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo, ProviderInfo } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    ai: {
      listModels: mocks.listModels,
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: toastMocks,
}))

import { useProviderModelsCache } from '../../../../src/renderer/pages/Models/hooks/useProviderModelsCache'

function model(id: string): ModelInfo {
  return {
    id,
    name: id,
    providerId: 'p',
    api: 'openai-completions',
    contextWindow: 8192,
    maxOutputTokens: 1024,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    costCacheRead: 0,
    costCacheWrite: 0,
    supportsReasoning: false,
    baseUrl: '',
  }
}

function provider(id: string, hasApiKey: boolean): ProviderInfo {
  return { id, name: id, supportsOAuth: false, hasApiKey, modelCount: 0 }
}

/** 手动控制的 deferred Promise */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
describe('useProviderModelsCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listModels.mockResolvedValue([model('m1'), model('m2')])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始状态', () => {
    it('modelsMap/modelsLoading/refreshTime 初始为空对象', () => {
      const { result } = renderHook(() => useProviderModelsCache())
      expect(result.current.modelsMap).toEqual({})
      expect(result.current.modelsLoading).toEqual({})
      expect(result.current.refreshTime).toEqual({})
    })

    it('getModels 未命中缓存时返回空数组', () => {
      const { result } = renderHook(() => useProviderModelsCache())
      expect(result.current.getModels('unknown')).toEqual([])
    })
  })

  describe('ensureLoaded', () => {
    it('首次调用拉取模型并写入缓存/刷新时间', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
      expect(mocks.listModels).toHaveBeenCalledWith('openai')
      expect(result.current.modelsMap.openai.map((m) => m.id)).toEqual(['m1', 'm2'])
      expect(result.current.modelsLoading.openai).toBe(false)
      expect(typeof result.current.refreshTime.openai).toBe('number')
      expect(result.current.getModels('openai')).toHaveLength(2)
    })

    it('已有缓存时跳过重复请求', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
      })
      await act(async () => {
        await result.current.ensureLoaded('openai')
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
    })

    it('inflight 去重: 并发调用只发一次请求', async () => {
      const d = deferred<ModelInfo[]>()
      mocks.listModels.mockReturnValue(d.promise)
      const { result } = renderHook(() => useProviderModelsCache())

      let p1: Promise<void> | undefined
      let p2: Promise<void> | undefined
      act(() => {
        p1 = result.current.ensureLoaded('openai')
        p2 = result.current.ensureLoaded('openai')
      })
      // 加载中标记已置位
      expect(result.current.modelsLoading.openai).toBe(true)

      await act(async () => {
        d.resolve([model('m1')])
        await Promise.all([p1, p2])
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
      expect(result.current.modelsLoading.openai).toBe(false)
      expect(result.current.modelsMap.openai).toHaveLength(1)
    })

    it('失败时不写入缓存,loading 复位,不 toast;失败后可重试', async () => {
      mocks.listModels.mockRejectedValue(new Error('network down'))
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
      })

      expect(result.current.modelsMap.openai).toBeUndefined()
      expect(result.current.modelsLoading.openai).toBe(false)
      expect(result.current.refreshTime.openai).toBeUndefined()
      expect(toastMocks.error).not.toHaveBeenCalled()

      mocks.listModels.mockResolvedValue([model('m1')])
      await act(async () => {
        await result.current.ensureLoaded('openai')
      })
      expect(mocks.listModels).toHaveBeenCalledTimes(2)
      expect(result.current.modelsMap.openai).toHaveLength(1)
    })
  })
  describe('refresh', () => {
    it('已有缓存也强制重新拉取,但不更新 refreshTime', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
      })
      const t0 = result.current.refreshTime.openai

      mocks.listModels.mockResolvedValue([model('fresh')])
      await act(async () => {
        await result.current.refresh('openai')
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(2)
      expect(result.current.modelsMap.openai.map((m) => m.id)).toEqual(['fresh'])
      expect(result.current.refreshTime.openai).toBe(t0)
    })

    it('失败时 toast.error 提示且不写缓存', async () => {
      mocks.listModels.mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.refresh('openai')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('刷新 openai 模型失败')
      expect(result.current.modelsMap.openai).toBeUndefined()
      expect(result.current.modelsLoading.openai).toBe(false)
    })

    it('inflight 去重: 并发 refresh 只发一次请求', async () => {
      const d = deferred<ModelInfo[]>()
      mocks.listModels.mockReturnValue(d.promise)
      const { result } = renderHook(() => useProviderModelsCache())

      let p1: Promise<void> | undefined
      let p2: Promise<void> | undefined
      act(() => {
        p1 = result.current.refresh('openai')
        p2 = result.current.refresh('openai')
      })
      await act(async () => {
        d.resolve([model('m1')])
        await Promise.all([p1, p2])
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('loadAll', () => {
    it('只加载已配置(hasApiKey)的 provider', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.loadAll([
          provider('configured', true),
          provider('not-configured', false),
        ])
      })

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
      expect(mocks.listModels).toHaveBeenCalledWith('configured')
      expect(result.current.modelsMap.configured).toHaveLength(2)
      expect(result.current.modelsMap['not-configured']).toBeUndefined()
      expect(result.current.modelsLoading.configured).toBe(false)
    })

    it('无已配置 provider 时不发请求', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.loadAll([provider('a', false), provider('b', false)])
      })

      expect(mocks.listModels).not.toHaveBeenCalled()
    })

    it('Promise.allSettled: 单个失败不影响其他 provider', async () => {
      mocks.listModels.mockImplementation(async (id: string) => {
        if (id === 'bad') throw new Error('no key')
        return [model(`${id}-m1`)]
      })
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.loadAll([provider('good', true), provider('bad', true)])
      })

      expect(result.current.modelsMap.good.map((m) => m.id)).toEqual(['good-m1'])
      expect(result.current.modelsMap.bad).toBeUndefined()
      expect(result.current.modelsLoading.good).toBe(false)
      expect(result.current.modelsLoading.bad).toBe(false)
    })
  })
  describe('clear', () => {
    it('清除指定 provider 的 modelsMap 和 refreshTime,不影响其他', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
        await result.current.ensureLoaded('other')
      })
      expect(result.current.modelsMap.openai).toBeDefined()
      expect(result.current.refreshTime.other).toBeDefined()

      act(() => {
        result.current.clear('openai')
      })

      expect(result.current.modelsMap.openai).toBeUndefined()
      expect(result.current.refreshTime.openai).toBeUndefined()
      expect(result.current.modelsMap.other).toBeDefined()
      expect(result.current.refreshTime.other).toBeDefined()
    })
  })

  describe('invalidateAndRefresh', () => {
    it('强制重新拉取且不更新 refreshTime', async () => {
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await result.current.ensureLoaded('openai')
      })
      const t0 = result.current.refreshTime.openai

      mocks.listModels.mockResolvedValue([model('after-custom-change')])
      await act(async () => {
        await result.current.invalidateAndRefresh('openai')
      })

      expect(result.current.modelsMap.openai.map((m) => m.id)).toEqual(['after-custom-change'])
      expect(result.current.refreshTime.openai).toBe(t0)
      expect(result.current.modelsLoading.openai).toBe(false)
    })

    it('拉取期间 loading 为 true', async () => {
      const d = deferred<ModelInfo[]>()
      mocks.listModels.mockReturnValue(d.promise)
      const { result } = renderHook(() => useProviderModelsCache())

      let p: Promise<void> | undefined
      act(() => {
        p = result.current.invalidateAndRefresh('openai')
      })
      expect(result.current.modelsLoading.openai).toBe(true)

      await act(async () => {
        d.resolve([model('m1')])
        await p
      })
      expect(result.current.modelsLoading.openai).toBe(false)
    })

    it('失败时 finally 复位 loading 且异常向上抛(不 toast)', async () => {
      mocks.listModels.mockRejectedValue(new Error('list failed'))
      const { result } = renderHook(() => useProviderModelsCache())

      await act(async () => {
        await expect(result.current.invalidateAndRefresh('openai')).rejects.toThrow('list failed')
      })

      expect(result.current.modelsLoading.openai).toBe(false)
      expect(toastMocks.error).not.toHaveBeenCalled()
    })
  })
})