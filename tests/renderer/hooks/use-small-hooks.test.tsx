// =============================================================
// 小 hook 收口 — useDebouncedCallback / useConfirmDialog / useFileUpload
// 覆盖: 防抖合并与最新闭包/卸载清理、确认对话框 payload 生命周期、
//       文件上传(pickFile 取消/读取失败/成功入列/按索引移除)
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { toastMocks } from '../helpers/mock-toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  pickFiles: vi.fn(),
}))

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({ sys: { readFile: mocks.readFile } }),
}))

vi.mock('../../../src/renderer/lib/dialog', () => ({
  pickFiles: mocks.pickFiles,
  pickFile: vi.fn(),
  saveAs: vi.fn(),
}))

vi.mock('../../../src/renderer/stores/toastStore', async () => (await import('../helpers/mock-toast')).mockToastStore)

import { useConfirmDialog } from '../../../src/renderer/hooks/useConfirmDialog'
import { useDebouncedCallback } from '../../../src/renderer/hooks/useDebouncedCallback'
import { useFileUpload } from '../../../src/renderer/pages/Chat/hooks/useFileUpload'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDebouncedCallback', () => {
  it('窗口内的多次调用只执行最后一次(携带最后参数)', async () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const { result } = renderHook(() => useDebouncedCallback(fn, 50))
      act(() => {
        result.current('a')
        vi.advanceTimersByTime(20)
        result.current('b')
        result.current('c')
      })
      expect(fn).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60)
      })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('c')
    } finally {
      vi.useRealTimers()
    }
  })

  it('卸载时清掉挂起的 timer(不再执行)', async () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 50))
      act(() => result.current('x'))
      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(fn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('总是执行最新闭包(fn 变化后调用新实现)', async () => {
    vi.useFakeTimers()
    try {
      let tag = 'v1'
      const { result, rerender } = renderHook(() => useDebouncedCallback(() => tag = 'new', 30))
      rerender()
      act(() => result.current())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40)
      })
      expect(tag).toBe('new')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useConfirmDialog', () => {
  it('void 场景: open 打开/close 关闭并清空 payload', () => {
    const { result } = renderHook(() => useConfirmDialog())
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.state.payload).toBeNull()
  })

  it('payload 场景: open 附带载荷,close 清空', () => {
    const { result } = renderHook(() => useConfirmDialog<{ id: number }>())
    act(() => result.current.open({ id: 7 }))
    expect(result.current.state).toEqual({ open: true, payload: { id: 7 } })
    act(() => result.current.close())
    expect(result.current.state.payload).toBeNull()
  })
})

describe('useFileUpload', () => {
  it('pickFile 取消 → 无任何动作', async () => {
    mocks.pickFiles.mockResolvedValue([])
    const { result } = renderHook(() => useFileUpload())
    await act(async () => {
      await result.current.handleUpload()
    })
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(result.current.uploadedFiles).toHaveLength(0)
  })

  it('读取失败 → 错误提示且不入列', async () => {
    mocks.pickFiles.mockResolvedValue(['/tmp/notes.txt'])
    mocks.readFile.mockResolvedValue({ success: false, error: 'too large' })
    const { result } = renderHook(() => useFileUpload())
    await act(async () => {
      await result.current.handleUpload()
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(result.current.uploadedFiles).toHaveLength(0)
  })

  it('读取成功 → 入列(名称/大小/MIME)并成功提示', async () => {
    mocks.pickFiles.mockResolvedValue(['/home/u/report.csv'])
    mocks.readFile.mockResolvedValue({
      success: true,
      name: 'report.csv',
      size: 2048,
      content: 'a,b',
      mimeType: 'text/csv',
    })
    const { result } = renderHook(() => useFileUpload())
    await act(async () => {
      await result.current.handleUpload()
    })
    expect(toastMocks.success).toHaveBeenCalled()
    expect(result.current.uploadedFiles).toEqual([
      {
        name: 'report.csv',
        path: '/home/u/report.csv',
        size: 2048,
        content: 'a,b',
        mimeType: 'text/csv',
      },
    ])
  })

  it('removeFile 按索引移除', async () => {
    const { result } = renderHook(() => useFileUpload())
    act(() => {
      result.current.setUploadedFiles([
        { name: 'a', path: '/a', size: 1, content: '', mimeType: 'text/plain' },
        { name: 'b', path: '/b', size: 2, content: '', mimeType: 'text/plain' },
      ])
    })
    act(() => result.current.removeFile(0))
    expect(result.current.uploadedFiles.map((f) => f.name)).toEqual(['b'])
  })
})
