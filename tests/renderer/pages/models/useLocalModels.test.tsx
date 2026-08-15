// =============================================================
// useLocalModels — 本地模型(Ollama)状态/轮询与动作 handlers 测试
// 覆盖: 初始 detect/listModels、onPullProgress 订阅与退订、
//       startServe/pull/delete 的成功与失败分支
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OllamaModelInfo, OllamaStatusInfo } from '@shared/types'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  listModels: vi.fn(),
  onPullProgress: vi.fn(),
  startServe: vi.fn(),
  pullModel: vi.fn(),
  deleteModel: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    ollama: {
      detect: mocks.detect,
      listModels: mocks.listModels,
      onPullProgress: mocks.onPullProgress,
      startServe: mocks.startServe,
      pullModel: mocks.pullModel,
      deleteModel: mocks.deleteModel,
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: toastMocks,
}))

import { useLocalModels } from '../../../../src/renderer/pages/Models/hooks/useLocalModels'

function status(p: Partial<OllamaStatusInfo>): OllamaStatusInfo {
  return { available: true, serveRunning: false, ...p }
}

function ollamaModel(name: string): OllamaModelInfo {
  return { name, size: 1024 }
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

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}
describe('useLocalModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detect.mockResolvedValue(status({ available: true, serveRunning: false }))
    mocks.listModels.mockResolvedValue([])
    mocks.onPullProgress.mockReturnValue(vi.fn()) // 返回 unsub
    mocks.startServe.mockResolvedValue({ success: true })
    mocks.pullModel.mockResolvedValue({ success: true })
    mocks.deleteModel.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始加载', () => {
    it('serve 未运行: installed 为空且不发 listModels', async () => {
      const { result } = renderHook(() => useLocalModels())
      await flush()

      expect(mocks.detect).toHaveBeenCalledTimes(1)
      expect(result.current.serveRunning).toBe(false)
      expect(result.current.available).toBe(true)
      expect(result.current.installed).toEqual([])
      expect(mocks.listModels).not.toHaveBeenCalled()
    })

    it('serve 运行中: 拉取已安装模型列表', async () => {
      mocks.detect.mockResolvedValue(status({ available: true, serveRunning: true }))
      mocks.listModels.mockResolvedValue([ollamaModel('llama3'), ollamaModel('qwen2.5')])
      const { result } = renderHook(() => useLocalModels())
      await flush()

      expect(mocks.listModels).toHaveBeenCalledTimes(1)
      expect(result.current.serveRunning).toBe(true)
      expect(result.current.installed.map((m) => m.name)).toEqual(['llama3', 'qwen2.5'])
    })

    it('detect 抛错: 静默忽略,状态保持默认', async () => {
      mocks.detect.mockRejectedValue(new Error('ipc down'))
      const { result } = renderHook(() => useLocalModels())
      await flush()

      expect(result.current.serveRunning).toBe(false)
      expect(result.current.available).toBe(false)
      expect(result.current.installed).toEqual([])
    })
  })

  describe('onPullProgress 订阅', () => {
    it('订阅回调更新 progress,卸载时退订', async () => {
      const unsub = vi.fn()
      mocks.onPullProgress.mockReturnValue(unsub)
      const { result, unmount } = renderHook(() => useLocalModels())
      await flush()

      expect(mocks.onPullProgress).toHaveBeenCalledTimes(1)
      const cb = mocks.onPullProgress.mock.calls[0][0] as (info: {
        model: string
        status: string
      }) => void

      act(() => {
        cb({ model: 'llama3', status: 'pulling', completed: 10, total: 100 })
      })
      expect(result.current.progress).toEqual({
        model: 'llama3',
        status: 'pulling',
        completed: 10,
        total: 100,
      })

      unmount()
      expect(unsub).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleStartServe', () => {
    it('成功: toast.success 并刷新状态', async () => {
      const { result } = renderHook(() => useLocalModels())
      await flush()
      mocks.detect.mockClear()

      await act(async () => {
        await result.current.handleStartServe()
      })

      expect(mocks.startServe).toHaveBeenCalledTimes(1)
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      // 刷新: detect 被再次调用
      expect(mocks.detect).toHaveBeenCalledTimes(1)
    })

    it('失败: toast.error', async () => {
      mocks.startServe.mockResolvedValue({ success: false })
      const { result } = renderHook(() => useLocalModels())
      await flush()

      await act(async () => {
        await result.current.handleStartServe()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(mocks.detect).toHaveBeenCalledTimes(1) // 未额外刷新
    })
  })
  describe('handlePull', () => {
    it('拉取期间 pulling/progress 置位,重复调用被忽略', async () => {
      const d = deferred<{ success: boolean }>()
      mocks.pullModel.mockReturnValue(d.promise)
      const { result } = renderHook(() => useLocalModels())
      await flush()

      let p1: Promise<void> | undefined
      act(() => {
        p1 = result.current.handlePull('llama3')
      })
      expect(result.current.pulling).toBe('llama3')
      expect(result.current.progress).toEqual({ model: 'llama3', status: 'starting' })

      // 拉取进行中,再次调用被忽略
      await act(async () => {
        await result.current.handlePull('llama3')
      })
      expect(mocks.pullModel).toHaveBeenCalledTimes(1)

      await act(async () => {
        d.resolve({ success: true })
        await p1
      })
      expect(result.current.pulling).toBe(null)
      expect(result.current.progress).toBe(null)
    })

    it('成功: toast.success 并刷新', async () => {
      const { result } = renderHook(() => useLocalModels())
      await flush()
      mocks.detect.mockClear()

      await act(async () => {
        await result.current.handlePull('llama3')
      })

      expect(mocks.pullModel).toHaveBeenCalledWith('llama3')
      expect(toastMocks.success).toHaveBeenCalledWith('llama3 下载完成')
      expect(mocks.detect).toHaveBeenCalledTimes(1)
    })

    it('失败: toast.error 显示错误', async () => {
      mocks.pullModel.mockResolvedValue({ success: false, error: 'disk full' })
      const { result } = renderHook(() => useLocalModels())
      await flush()

      await act(async () => {
        await result.current.handlePull('llama3')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('下载失败: disk full')
      expect(result.current.pulling).toBe(null)
    })
  })

  describe('handleDelete', () => {
    it('成功: toast.success 并刷新', async () => {
      const { result } = renderHook(() => useLocalModels())
      await flush()
      mocks.detect.mockClear()

      await act(async () => {
        await result.current.handleDelete('llama3')
      })

      expect(mocks.deleteModel).toHaveBeenCalledWith('llama3')
      expect(toastMocks.success).toHaveBeenCalledWith('已删除 llama3')
      expect(mocks.detect).toHaveBeenCalledTimes(1)
    })

    it('失败: toast.error 显示错误', async () => {
      mocks.deleteModel.mockResolvedValue({ success: false, error: 'not found' })
      const { result } = renderHook(() => useLocalModels())
      await flush()

      await act(async () => {
        await result.current.handleDelete('llama3')
      })

      expect(toastMocks.error).toHaveBeenCalledWith('删除失败: not found')
    })
  })
})