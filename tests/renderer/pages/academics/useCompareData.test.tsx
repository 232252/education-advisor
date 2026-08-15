// =============================================================
// useCompareData 单元测试 — 成绩对比 Tab 状态与数据加载
// mock window.api (academic.getClassGrades / eaa.range)
// =============================================================

import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useCompareData } from '../../../../src/renderer/pages/Academics/hooks/useCompareData'

// ---------- 数据工厂 ----------

function makeStudent(overrides: Partial<EAAStudent> = {}): EAAStudent {
  return {
    name: '张三',
    entity_id: 'ent-1',
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
    ...overrides,
  }
}

function makeExam(overrides: Partial<ExamDef> = {}): ExamDef {
  return {
    id: 'e1',
    name: '月考一',
    type: 'monthly',
    date: '2025-10-01',
    semester: '2025-2026-1',
    subjects: ['chinese'],
    createdAt: '2025-10-02T00:00:00Z',
    ...overrides,
  }
}

function makeGrade(overrides: Partial<GradeRecord> = {}): GradeRecord {
  return {
    examId: 'e1',
    subjectId: 'chinese',
    studentName: '张三',
    score: 80,
    fullMark: 150,
    updatedAt: '2025-10-02T00:00:00Z',
    ...overrides,
  }
}

const SUBJECTS: SubjectDef[] = [{ id: 'chinese', name: '语文', category: 'core', fullMark: 150 }]

function defaultParams() {
  return {
    students: [makeStudent({ name: '张三' }), makeStudent({ name: '李四', entity_id: 'ent-2' })],
    subjects: SUBJECTS,
    exams: [
      makeExam({ id: 'e1', date: '2025-10-01' }),
      makeExam({ id: 'e2', date: '2025-11-01' }),
      makeExam({ id: 'e3', date: '2025-12-01' }),
    ],
  }
}

/** 固定 params 渲染 (引用稳定, 避免无限重跑) */
function setup(overrides: Partial<ReturnType<typeof defaultParams>> = {}) {
  const params = { ...defaultParams(), ...overrides }
  return renderHook(() => useCompareData(params))
}

// ---------- window.api mock ----------

const apiMock = {
  academic: {
    getClassGrades: vi.fn(),
  },
  eaa: {
    range: vi.fn(),
  },
}

describe('useCompareData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = apiMock
    apiMock.academic.getClassGrades.mockResolvedValue({ success: true, data: {} })
    apiMock.eaa.range.mockResolvedValue({ success: true, data: { events: [] } })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('初始状态: 默认选最近两场考试(升序倒数第二与最后一场)', async () => {
    const { result } = setup()
    expect(result.current.classFilter).toBe('__ALL__')
    expect(result.current.examAId).toBe('e2')
    expect(result.current.examBId).toBe('e3')
    expect(result.current.sortedExams.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(result.current.canCompare).toBe(true)
  })

  it('不足两场考试时不预选', () => {
    const { result } = setup({ exams: [makeExam({ id: 'e1' })] })
    expect(result.current.examAId).toBe('')
    expect(result.current.examBId).toBe('')
    expect(result.current.canCompare).toBeFalsy()
  })

  it('targetStudentNames 随班级筛选变化并剔除已删除学生', () => {
    const students = [
      makeStudent({ name: '张三', class_id: 'c1' }),
      makeStudent({ name: '李四', class_id: null }),
      makeStudent({ name: '王五', class_id: 'c1', status: 'Deleted' }),
    ]
    const { result } = setup({ students, exams: [makeExam({ id: 'e1' })] })
    expect(result.current.targetStudentNames.slice().sort()).toEqual(['张三', '李四'])
    act(() => {
      result.current.setClassFilter('c1')
    })
    expect(result.current.targetStudentNames).toEqual(['张三'])
    act(() => {
      result.current.setClassFilter('__NONE__')
    })
    expect(result.current.targetStudentNames).toEqual(['李四'])
  })

  it('两场考试均加载成功后计算对比结果与汇总', async () => {
    apiMock.academic.getClassGrades.mockImplementation(
      async (_names: string[], examId: string) => {
        if (examId === 'e2') {
          return {
            success: true,
            data: { 张三: [makeGrade({ examId: 'e2', score: 80 })] },
          }
        }
        return {
          success: true,
          data: { 张三: [makeGrade({ examId: 'e3', score: 90 })] },
        }
      },
    )
    const { result } = setup()

    await waitFor(() => {
      expect(result.current.studentComparisons).toHaveLength(1)
    })
    const comp = result.current.studentComparisons[0]
    expect(comp.studentName).toBe('张三')
    expect(comp.totalScoreDelta).toBe(10)
    expect(comp.subjects[0].subjectName).toBe('语文')
    expect(result.current.summary).not.toBeNull()
    expect(result.current.summary?.avgScoreDelta).toBe(10)
    expect(result.current.loading).toBe(false)
  })

  it('加载时按考试日期区间调用 eaa.range', async () => {
    setup()
    await waitFor(() => {
      expect(apiMock.eaa.range).toHaveBeenCalledWith('2025-11-01', '2025-12-01', 5000)
    })
  })

  it('同一考试选中两次(A==B)时不加载且清空对比结果', async () => {
    const { result } = setup()
    await waitFor(() => {
      expect(apiMock.academic.getClassGrades).toHaveBeenCalled()
    })
    vi.clearAllMocks()
    act(() => {
      result.current.setExamBId('e2') // 与 examAId 相同
    })
    await waitFor(() => {
      expect(apiMock.academic.getClassGrades).not.toHaveBeenCalled()
    })
    expect(result.current.studentComparisons).toEqual([])
    expect(result.current.summary).toBeNull()
    expect(result.current.canCompare).toBe(false)
  })

  it('班级无学生时不加载', () => {
    const { result } = setup({ students: [] })
    expect(apiMock.academic.getClassGrades).not.toHaveBeenCalled()
    expect(result.current.canCompare).toBe(false)
    expect(result.current.studentComparisons).toEqual([])
  })

  it('getClassGrades 失败时对比结果为空', async () => {
    apiMock.academic.getClassGrades.mockResolvedValue({ success: false, error: 'db' })
    const { result } = setup()
    // 等待 loading 完成
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.studentComparisons).toEqual([])
    expect(result.current.summary).toBeNull()
  })

  it('eaa.range 抛错时 conductDelta 仍为 null 但对比结果正常', async () => {
    apiMock.eaa.range.mockRejectedValue(new Error('eaa down'))
    apiMock.academic.getClassGrades.mockImplementation(
      async (_names: string[], examId: string) => ({
        success: true,
        data: { 张三: [makeGrade({ examId, score: examId === 'e3' ? 90 : 80 })] },
      }),
    )
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.studentComparisons).toHaveLength(1)
    })
    expect(result.current.studentComparisons[0].conductDelta).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
