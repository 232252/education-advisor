// =============================================================
// useStudentGrades 单元测试 — 按选中学生加载成绩记录
// mock window.api.academic.getGrades
// =============================================================

import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradeRecord } from '@shared/types'
import { useStudentGrades } from '../../../../src/renderer/pages/Academics/hooks/useStudentGrades'

// ---------- 数据工厂 ----------

function makeGrade(overrides: Partial<GradeRecord> = {}): GradeRecord {
  return {
    examId: 'exam-1',
    subjectId: 'chinese',
    studentName: '张三',
    score: 90,
    fullMark: 150,
    updatedAt: '2025-11-02T00:00:00Z',
    ...overrides,
  }
}

// ---------- window.api mock ----------

const apiMock = {
  academic: {
    getGrades: vi.fn(),
  },
}

describe('useStudentGrades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = apiMock
    apiMock.academic.getGrades.mockResolvedValue({ success: true, data: [] })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('初始无学生时成绩为空且不调 IPC', () => {
    const { result } = renderHook(() => useStudentGrades(null))
    expect(result.current.grades).toEqual([])
    expect(result.current.gradesLoading).toBe(false)
    expect(apiMock.academic.getGrades).not.toHaveBeenCalled()
  })

  it('选中学生后加载成绩', async () => {
    const grades = [makeGrade(), makeGrade({ subjectId: 'math', score: 85 })]
    apiMock.academic.getGrades.mockResolvedValue({ success: true, data: grades })
    const { result } = renderHook(() => useStudentGrades('张三'))
    await waitFor(() => {
      expect(result.current.grades).toHaveLength(2)
    })
    expect(apiMock.academic.getGrades).toHaveBeenCalledWith('张三')
    expect(result.current.gradesLoading).toBe(false)
  })

  it('返回 success=false 时成绩置空', async () => {
    apiMock.academic.getGrades.mockResolvedValue({ success: false, error: 'not found' })
    const { result } = renderHook(() => useStudentGrades('张三'))
    await waitFor(() => {
      expect(result.current.gradesLoading).toBe(false)
    })
    expect(result.current.grades).toEqual([])
  })

  it('IPC 抛错时成绩置空且 loading 复位', async () => {
    apiMock.academic.getGrades.mockRejectedValue(new Error('ipc down'))
    const { result } = renderHook(() => useStudentGrades('张三'))
    await waitFor(() => {
      expect(result.current.gradesLoading).toBe(false)
    })
    expect(result.current.grades).toEqual([])
  })

  it('切换学生时重新加载新学生成绩', async () => {
    apiMock.academic.getGrades.mockImplementation(async (name: string) => ({
      success: true,
      data: [makeGrade({ studentName: name })],
    }))
    const { result, rerender } = renderHook((name: string | null) => useStudentGrades(name), {
      initialProps: '张三',
    })
    await waitFor(() => {
      expect(result.current.grades[0]?.studentName).toBe('张三')
    })
    rerender('李四')
    await waitFor(() => {
      expect(result.current.grades[0]?.studentName).toBe('李四')
    })
    expect(apiMock.academic.getGrades).toHaveBeenNthCalledWith(2, '李四')
  })

  it('切换到 null 时清空成绩且不再调用 IPC', async () => {
    apiMock.academic.getGrades.mockResolvedValue({
      success: true,
      data: [makeGrade()],
    })
    const { result, rerender } = renderHook((name: string | null) => useStudentGrades(name), {
      initialProps: '张三',
    })
    await waitFor(() => {
      expect(result.current.grades).toHaveLength(1)
    })
    rerender(null)
    await waitFor(() => {
      expect(result.current.grades).toEqual([])
    })
    expect(apiMock.academic.getGrades).toHaveBeenCalledTimes(1)
  })

  it('reloadGrades 重新拉取当前学生', async () => {
    apiMock.academic.getGrades.mockResolvedValue({ success: true, data: [makeGrade()] })
    const { result } = renderHook(() => useStudentGrades('张三'))
    await waitFor(() => {
      expect(apiMock.academic.getGrades).toHaveBeenCalledTimes(1)
    })
    await act(async () => {
      result.current.reloadGrades()
    })
    expect(apiMock.academic.getGrades).toHaveBeenCalledTimes(2)
  })

  it('无学生时 reloadGrades 不触发加载', async () => {
    const { result } = renderHook(() => useStudentGrades(null))
    await act(async () => {
      result.current.reloadGrades()
    })
    expect(apiMock.academic.getGrades).not.toHaveBeenCalled()
  })
})
