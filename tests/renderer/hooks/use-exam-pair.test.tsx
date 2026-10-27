// =============================================================
// useExamPair — 考试对选择默认值保持 + 操行区间事件测试
// 覆盖: 默认选最近两场、不足两场不预选、晚到列表补默认但不覆盖
// 手动选择、缺考试/日期回 null、成功/失败/异常三态、代际防护
// (切对后晚到的旧响应不得覆盖新数据)。
// =============================================================

import { act } from '@testing-library/react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAAEventRecord, ExamDef } from '@shared/types'

const mocks = vi.hoisted(() => ({
  range: vi.fn(),
}))

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({ eaa: { range: mocks.range } }),
}))

import {
  useConductEvents,
  useExamPairSelection,
} from '../../../src/renderer/hooks/useExamPair'

function exam(id: string, date: string): ExamDef {
  return { id, name: id, date } as ExamDef
}

const EV: EAAEventRecord[] = [{ id: 1 } as EAAEventRecord]

describe('useExamPairSelection', () => {
  it('≥2 场: 默认选倒数第二(A)与最后一场(B)', () => {
    const exams = [exam('e1', '2026-01-01'), exam('e2', '2026-02-01'), exam('e3', '2026-03-01')]
    const { result } = renderHook(() => useExamPairSelection(exams))
    expect(result.current.examAId).toBe('e2')
    expect(result.current.examBId).toBe('e3')
  })

  it('不足两场不预选;晚到列表补默认', () => {
    const { result, rerender } = renderHook(({ exams }: { exams: ExamDef[] }) =>
      useExamPairSelection(exams),
      { initialProps: { exams: [exam('e1', '2026-01-01')] } },
    )
    expect(result.current.examAId).toBe('')
    expect(result.current.examBId).toBe('')

    rerender({ exams: [exam('e1', '2026-01-01'), exam('e2', '2026-02-01')] })
    expect(result.current.examAId).toBe('e1')
    expect(result.current.examBId).toBe('e2')
  })

  it('手动选择不被晚到列表覆盖', () => {
    const { result, rerender } = renderHook(({ exams }: { exams: ExamDef[] }) =>
      useExamPairSelection(exams),
      { initialProps: { exams: [] as ExamDef[] } },
    )
    rerender({ exams: [exam('e1', '2026-01-01'), exam('e2', '2026-02-01'), exam('e3', '2026-03-01')] })
    act(() => {
      result.current.setExamAId('e1')
    })
    rerender({ exams: [exam('e1', '2026-01-01'), exam('e2', '2026-02-01'), exam('e3', '2026-03-01')] })
    expect(result.current.examAId).toBe('e1')
    expect(result.current.examBId).toBe('e3')
  })
})

describe('useConductEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('缺考试/日期/任一 id 为空: null 且不调 API', () => {
    const exams = [exam('e1', '2026-01-01'), exam('e2', '2026-02-01')]
    const { result } = renderHook(() => useConductEvents(exams, '', 'e2', 10))
    expect(result.current).toBeNull()
    const { result: r2 } = renderHook(() => useConductEvents(exams, 'e1', 'ghost', 10))
    expect(r2.current).toBeNull()
    expect(mocks.range).not.toHaveBeenCalled()
  })

  it('成功返回事件;失败信封与异常都回 null', async () => {
    const exams = [exam('e1', '2026-01-01'), exam('e2', '2026-02-01')]
    mocks.range.mockResolvedValueOnce({ success: true, data: { events: EV } })
    const { result } = renderHook(() => useConductEvents(exams, 'e1', 'e2', 10))
    await waitFor(() => expect(result.current).toEqual(EV))
    expect(mocks.range).toHaveBeenCalledWith('2026-01-01', '2026-02-01', 10)

    mocks.range.mockResolvedValueOnce({ success: false, error: 'x' })
    const { result: r2 } = renderHook(() => useConductEvents(exams, 'e1', 'e2', 10))
    await waitFor(() => expect(r2.current).toBeNull())

    mocks.range.mockRejectedValueOnce(new Error('ipc down'))
    const { result: r3 } = renderHook(() => useConductEvents(exams, 'e1', 'e2', 10))
    await waitFor(() => expect(r3.current).toBeNull())
  })

  it('代际防护: 切对后晚到的旧响应不覆盖新数据', async () => {
    const exams = [
      exam('e1', '2026-01-01'),
      exam('e2', '2026-02-01'),
      exam('e3', '2026-03-01'),
    ]
    let resolveOld: (v: unknown) => void = () => {}
    mocks.range.mockImplementationOnce(
      () =>
      new Promise((res) => {
        resolveOld = res
      }),
    )
    mocks.range.mockResolvedValueOnce({ success: true, data: { events: [{ id: 2 } as EAAEventRecord] } })

    const { result, rerender } = renderHook(
      ({ a }: { a: string }) => useConductEvents(exams, a, 'e3', 10),
      { initialProps: { a: 'e1' } },
    )
    rerender({ a: 'e2' })
    await waitFor(() => expect(result.current).toEqual([{ id: 2 } as EAAEventRecord]))

    // 旧响应此刻才返回,不得覆盖
    await act(async () => {
      resolveOld({ success: true, data: { events: EV } })
    })
    expect(result.current).toEqual([{ id: 2 } as EAAEventRecord])
  })
})