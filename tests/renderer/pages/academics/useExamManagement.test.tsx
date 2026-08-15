// =============================================================
// useExamManagement 单元测试 — 考试管理 Tab 表单状态与动作
// mock window.api.academic (createExam/deleteExam)
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamDef, SubjectDef } from '@shared/types'
import { useExamManagement } from '../../../../src/renderer/pages/Academics/hooks/useExamManagement'
import { toast } from '../../../../src/renderer/stores/toastStore'

// ---------- 数据工厂 ----------

const SUBJECTS: SubjectDef[] = [
  { id: 'chinese', name: '语文', category: 'core', fullMark: 150 },
  { id: 'math', name: '数学', category: 'core', fullMark: 150 },
]

function makeExam(overrides: Partial<ExamDef> = {}): ExamDef {
  return {
    id: 'exam-1',
    name: '期中考试',
    type: 'midterm',
    date: '2025-11-01',
    semester: '2025-2026-1',
    subjects: ['chinese', 'math'],
    createdAt: '2025-11-02T00:00:00Z',
    ...overrides,
  }
}

// ---------- window.api mock ----------

const apiMock = {
  academic: {
    createExam: vi.fn(),
    deleteExam: vi.fn(),
  },
}

function setup() {
  const onRefresh = vi.fn()
  const { result } = renderHook(() => useExamManagement({ subjects: SUBJECTS, onRefresh }))
  return { result, onRefresh }
}

/** 填充一个完整合法的创建表单 */
function fillValidForm(result: ReturnType<typeof setup>['result']) {
  act(() => {
    result.current.setFormName('  月考二  ')
    result.current.setFormType('monthly')
    result.current.setFormDate('2025-10-10')
    result.current.setFormSemester('2025-2026-1')
    result.current.setFormScope('  全年级  ')
    result.current.handleToggleSubject('chinese')
  })
}

describe('useExamManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = apiMock
    apiMock.academic.createExam.mockResolvedValue({ success: true })
    apiMock.academic.deleteExam.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  // ---------- 初始状态 ----------

  it('初始状态: 表单字段为默认值', () => {
    const { result } = setup()
    expect(result.current.showCreateForm).toBe(false)
    expect(result.current.creating).toBe(false)
    expect(result.current.deleteConfirm).toEqual({ open: false, exam: null })
    expect(result.current.formName).toBe('')
    expect(result.current.formType).toBe('monthly')
    expect(result.current.formDate).toMatch(/^\d{4}-\d{2}-\d{2}$/) // 今天
    expect(result.current.formSemester).toMatch(/^\d{4}-\d{4}-[12]$/) // 当前学期
    expect(result.current.formScope).toBe('')
    expect(result.current.formSubjects.size).toBe(0)
  })

  // ---------- 科目选择 ----------

  it('handleToggleSubject 切换科目选中状态', () => {
    const { result } = setup()
    act(() => {
      result.current.handleToggleSubject('chinese')
    })
    expect(result.current.formSubjects.has('chinese')).toBe(true)
    act(() => {
      result.current.handleToggleSubject('chinese')
    })
    expect(result.current.formSubjects.has('chinese')).toBe(false)
  })

  it('handleSelectAllSubjects 全选 / handleClearSubjects 清空', () => {
    const { result } = setup()
    act(() => {
      result.current.handleSelectAllSubjects()
    })
    expect([...result.current.formSubjects].sort()).toEqual(['chinese', 'math'])
    act(() => {
      result.current.handleClearSubjects()
    })
    expect(result.current.formSubjects.size).toBe(0)
  })

  it('resetForm 恢复默认值', () => {
    const { result } = setup()
    fillValidForm(result)
    act(() => {
      result.current.resetForm()
    })
    expect(result.current.formName).toBe('')
    expect(result.current.formType).toBe('monthly')
    expect(result.current.formScope).toBe('')
    expect(result.current.formSubjects.size).toBe(0)
    expect(result.current.formDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // ---------- handleCreate ----------

  it('创建: 名称为空报错且不调 IPC', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    act(() => {
      result.current.handleToggleSubject('chinese')
    })
    await act(async () => {
      await result.current.handleCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.createExam).not.toHaveBeenCalled()
  })

  it('创建: 未选科目报错且不调 IPC', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    act(() => {
      result.current.setFormName('月考二')
    })
    await act(async () => {
      await result.current.handleCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.createExam).not.toHaveBeenCalled()
  })

  it('创建: 成功时提交 trim 后的表单并复位/关闭/刷新', async () => {
    const toastSpy = vi.spyOn(toast, 'success')
    const { result, onRefresh } = setup()
    fillValidForm(result)
    act(() => {
      result.current.setShowCreateForm(true)
    })
    await act(async () => {
      await result.current.handleCreate()
    })
    expect(apiMock.academic.createExam).toHaveBeenCalledTimes(1)
    expect(apiMock.academic.createExam.mock.calls[0][0]).toEqual({
      name: '月考二',
      type: 'monthly',
      date: '2025-10-10',
      semester: '2025-2026-1',
      scope: '全年级',
      subjects: ['chinese'],
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.showCreateForm).toBe(false)
    expect(result.current.formName).toBe('')
    expect(result.current.formSubjects.size).toBe(0)
    expect(result.current.creating).toBe(false)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('创建: 学期为空时回退当前学期, 范围为空时传 undefined', async () => {
    const { result } = setup()
    act(() => {
      result.current.setFormName('随堂测')
      result.current.setFormSemester('   ')
      result.current.handleToggleSubject('math')
    })
    await act(async () => {
      await result.current.handleCreate()
    })
    const payload = apiMock.academic.createExam.mock.calls[0][0]
    expect(payload.semester).toMatch(/^\d{4}-\d{4}-[12]$/)
    expect(payload.scope).toBeUndefined()
  })

  it('创建: IPC 返回失败时报错', async () => {
    apiMock.academic.createExam.mockResolvedValue({ success: false, error: 'duplicated' })
    const toastSpy = vi.spyOn(toast, 'error')
    const { result, onRefresh } = setup()
    fillValidForm(result)
    await act(async () => {
      await result.current.handleCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(result.current.creating).toBe(false)
    // 失败时表单保留,便于修改重试
    expect(result.current.formName.trim()).toBe('月考二')
  })

  it('创建: IPC 抛错时报错且复位 creating', async () => {
    apiMock.academic.createExam.mockRejectedValue(new Error('ipc broken'))
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    fillValidForm(result)
    await act(async () => {
      await result.current.handleCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.creating).toBe(false)
  })

  // ---------- 删除 ----------

  it('handleDelete 打开确认对话框并记录目标考试', () => {
    const { result } = setup()
    const exam = makeExam()
    act(() => {
      result.current.handleDelete(exam)
    })
    expect(result.current.deleteConfirm).toEqual({ open: true, exam })
  })

  it('executeDelete: 确认后删除考试并刷新', async () => {
    const toastSpy = vi.spyOn(toast, 'success')
    const { result, onRefresh } = setup()
    const exam = makeExam()
    act(() => {
      result.current.handleDelete(exam)
    })
    await act(async () => {
      await result.current.executeDelete()
    })
    expect(apiMock.academic.deleteExam).toHaveBeenCalledWith('exam-1')
    expect(toastSpy).toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(result.current.deleteConfirm).toEqual({ open: false, exam: null })
  })

  it('executeDelete: 无目标考试时不调 IPC', async () => {
    const { result, onRefresh } = setup()
    await act(async () => {
      await result.current.executeDelete()
    })
    expect(apiMock.academic.deleteExam).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('executeDelete: 删除失败时报错', async () => {
    apiMock.academic.deleteExam.mockResolvedValue({ success: false, error: 'has grades' })
    const toastSpy = vi.spyOn(toast, 'error')
    const { result, onRefresh } = setup()
    act(() => {
      result.current.handleDelete(makeExam())
    })
    await act(async () => {
      await result.current.executeDelete()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('executeDelete: IPC 抛错时报错', async () => {
    apiMock.academic.deleteExam.mockRejectedValue(new Error('boom'))
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    act(() => {
      result.current.handleDelete(makeExam())
    })
    await act(async () => {
      await result.current.executeDelete()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.deleteConfirm.open).toBe(false)
  })
})
