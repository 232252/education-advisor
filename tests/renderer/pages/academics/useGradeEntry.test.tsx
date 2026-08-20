// =============================================================
// useGradeEntry 单元测试 — 成绩录入 Tab 状态与 handlers
// mock window.api (academic/ai 域) + chatStore 模型状态
// 注意: renderHook 必须传入稳定 props 引用 (源码 effect 依赖
//       students/exams 引用, 若每次渲染生成新对象会引发无限重跑)
// =============================================================

import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { useGradeEntry } from '../../../../src/renderer/pages/Academics/hooks/useGradeEntry'
import { useChatStore } from '../../../../src/renderer/stores/chat/store'
import { toast } from '../../../../src/renderer/stores/toastStore'

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

const SUBJECT_CHINESE: SubjectDef = { id: 'chinese', name: '语文', category: 'core', fullMark: 150 }
const SUBJECT_MATH: SubjectDef = { id: 'math', name: '数学', category: 'core', fullMark: 150 }

function defaultArgs() {
  return {
    studentName: '张三',
    students: [makeStudent({ name: '张三' }), makeStudent({ name: '李四', entity_id: 'ent-2' })],
    subjects: [SUBJECT_CHINESE, SUBJECT_MATH],
    subjectMap: { chinese: SUBJECT_CHINESE, math: SUBJECT_MATH },
    exams: [
      makeExam({ id: 'exam-1', name: '期中考试', date: '2025-11-01' }),
      makeExam({ id: 'exam-2', name: '期末考试', date: '2025-12-20' }),
    ],
    currentGrades: [] as GradeRecord[],
    onSaved: vi.fn(),
    onExamCreated: vi.fn(),
  }
}

/** 固定 props 渲染 (props 引用稳定, 避免 effect 无限重跑) */
function setup(overrides: Partial<ReturnType<typeof defaultArgs>> = {}) {
  const props = { ...defaultArgs(), ...overrides }
  return renderHook(() => useGradeEntry(props))
}

// ---------- window.api mock ----------

const apiMock = {
  academic: {
    getClassGrades: vi.fn(),
    createExam: vi.fn(),
    batchSetGrades: vi.fn(),
  },
  ai: {
    onStream: vi.fn(),
    chat: vi.fn(),
  },
}

describe('useGradeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: unknown }).api = apiMock
    apiMock.academic.getClassGrades.mockResolvedValue({ success: true, data: {} })
    apiMock.academic.createExam.mockResolvedValue({
      success: true,
      data: makeExam({ id: 'exam-new', name: '新建考试' }),
    })
    apiMock.academic.batchSetGrades.mockResolvedValue({ success: true, data: 1 })
    apiMock.ai.onStream.mockReturnValue(vi.fn())
    apiMock.ai.chat.mockResolvedValue({ success: true, message: 'ok', sessionId: 'sess-1' })
    useChatStore.setState({ currentProvider: '', currentModel: '' })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  // ---------- 初始状态 ----------

  it('初始状态正确', () => {
    const { result } = setup()
    const h = result.current
    expect(h.mode).toBe('single-subject')
    expect(h.selectedExamId).toBe('')
    expect(h.saving).toBe(false)
    expect(h.singleScores).toEqual({})
    expect(h.allScores).toEqual({})
    expect(h.showQuickCreate).toBe(false)
    expect(h.showAIEntry).toBe(false)
    expect(h.aiParsing).toBe(false)
    expect(h.entryStudentName).toBe('张三')
  })

  it('sortedExams 按日期降序', () => {
    const { result } = setup()
    expect(result.current.sortedExams.map((e) => e.id)).toEqual(['exam-2', 'exam-1'])
  })

  it('selectedExam 返回当前选中考试', () => {
    const { result } = setup()
    act(() => {
      result.current.setSelectedExamId('exam-1')
    })
    expect(result.current.selectedExam?.name).toBe('期中考试')
    act(() => {
      result.current.setSelectedExamId('nope')
    })
    expect(result.current.selectedExam).toBeNull()
  })

  // ---------- 分数表更新 ----------

  it('updateSingleScore 更新学生分数并保留另一字段', () => {
    const { result } = setup()
    act(() => {
      result.current.updateSingleScore('李四', 'score', '88')
    })
    expect(result.current.singleScores['李四']).toEqual({ score: '88', rank: '' })
    act(() => {
      result.current.updateSingleScore('李四', 'rank', '5')
    })
    expect(result.current.singleScores['李四']).toEqual({ score: '88', rank: '5' })
  })

  it('updateAllScore 更新科目分数', () => {
    const { result } = setup()
    act(() => {
      result.current.updateAllScore('math', 'score', '95')
    })
    expect(result.current.allScores['math']).toEqual({ score: '95', rank: '' })
    act(() => {
      result.current.updateAllScore('math', 'rank', '2')
    })
    expect(result.current.allScores['math']).toEqual({ score: '95', rank: '2' })
  })

  it('切换学生同步 entryStudentName', () => {
    const props = defaultArgs()
    const { result, rerender } = renderHook((p: typeof props) => useGradeEntry(p), {
      initialProps: props,
    })
    const next = { ...props, studentName: '李四' }
    rerender(next)
    expect(result.current.entryStudentName).toBe('李四')
  })

  // ---------- 已有成绩回填 ----------

  it('单科模式: 选择考试+科目后已有成绩被回填', async () => {
    // currentGrades 同步回填后, getClassGrades 异步加载会覆盖,
    // 两个来源返回相同数据, 验证最终单元格值正确
    const grades = [
      makeGrade({ examId: 'exam-1', subjectId: 'chinese', studentName: '张三', score: 92, classRank: 3 }),
      makeGrade({ examId: 'exam-1', subjectId: 'math', studentName: '张三', score: 80 }),
    ]
    apiMock.academic.getClassGrades.mockResolvedValue({
      success: true,
      data: { 张三: [grades[0]] },
    })
    const { result } = setup({ currentGrades: grades })
    act(() => {
      result.current.setSelectedSubjectId('chinese')
    })
    await act(async () => {
      result.current.setSelectedExamId('exam-1')
    })
    await waitFor(() => {
      expect(result.current.singleScores['张三']).toEqual({ score: '92', rank: '3' })
    })
  })

  it('全科模式: 选择考试后回填当前学生所有科目成绩', async () => {
    const { result } = setup({
      currentGrades: [
        makeGrade({ examId: 'exam-1', subjectId: 'chinese', studentName: '张三', score: 92 }),
        makeGrade({ examId: 'exam-1', subjectId: 'math', studentName: '张三', score: 88, classRank: 5 }),
        makeGrade({ examId: 'exam-1', subjectId: 'math', studentName: '李四', score: 70 }),
      ],
    })
    await act(async () => {
      result.current.setMode('all-subjects')
    })
    await act(async () => {
      result.current.setSelectedExamId('exam-1')
    })
    expect(Object.keys(result.current.allScores).sort()).toEqual(['chinese', 'math'])
    expect(result.current.allScores['chinese']).toEqual({ score: '92', rank: '' })
    expect(result.current.allScores['math']).toEqual({ score: '88', rank: '5' })
  })

  it('单科模式: 切换考试+科目时通过 getClassGrades 加载班级成绩', async () => {
    apiMock.academic.getClassGrades.mockResolvedValue({
      success: true,
      data: {
        李四: [makeGrade({ studentName: '李四', examId: 'exam-1', subjectId: 'chinese', score: 85, classRank: 6 })],
      },
    })
    const { result } = setup()
    act(() => {
      result.current.setSelectedSubjectId('chinese')
    })
    await act(async () => {
      result.current.setSelectedExamId('exam-1')
    })
    await waitFor(() => {
      expect(apiMock.academic.getClassGrades).toHaveBeenCalledWith(
        ['张三', '李四'],
        'exam-1',
        'chinese',
      )
    })
    await waitFor(() => {
      expect(result.current.singleScores['李四']).toEqual({ score: '85', rank: '6' })
    })
  })

  it('getClassGrades 失败时静默不清空输入', async () => {
    apiMock.academic.getClassGrades.mockRejectedValue(new Error('ipc down'))
    const { result } = setup()
    act(() => {
      result.current.updateSingleScore('张三', 'score', '66')
    })
    act(() => {
      result.current.setSelectedSubjectId('chinese')
    })
    await act(async () => {
      result.current.setSelectedExamId('exam-1')
    })
    // 切换科目清空了输入; 重新输入后加载失败不覆盖本地输入
    act(() => {
      result.current.updateSingleScore('张三', 'score', '66')
    })
    await waitFor(() => {
      expect(apiMock.academic.getClassGrades).toHaveBeenCalled()
    })
    expect(result.current.singleScores['张三']).toEqual({ score: '66', rank: '' })
  })

  // ---------- handleSaveSingle ----------

  it('未选科目时保存报错且不调 IPC', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.batchSetGrades).not.toHaveBeenCalled()
  })

  it('无有效分数时保存报错且不调 IPC', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    await act(async () => {
      result.current.setSelectedSubjectId('chinese')
    })
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.batchSetGrades).not.toHaveBeenCalled()
  })

  it('已选考试时保存: 记录带 examId 且触发 onSaved', async () => {
    const toastSpy = vi.spyOn(toast, 'success')
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    // 步骤1: 选择科目+考试 (触发清空与班级成绩加载)
    await act(async () => {
      result.current.setSelectedSubjectId('chinese')
      result.current.setSelectedExamId('exam-1')
    })
    // 步骤2: 录入分数
    act(() => {
      result.current.updateSingleScore('张三', 'score', '93')
      result.current.updateSingleScore('张三', 'rank', '2')
      result.current.updateSingleScore('李四', 'score', '81')
    })
    // 步骤3: 保存
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(apiMock.academic.batchSetGrades).toHaveBeenCalledTimes(1)
    const records = apiMock.academic.batchSetGrades.mock.calls[0][0]
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      examId: 'exam-1',
      subjectId: 'chinese',
      studentName: '张三',
      score: 93,
      fullMark: 150,
      classRank: 2,
    })
    expect(records[1]).toMatchObject({ studentName: '李四', score: 81, examId: 'exam-1' })
    expect(props.onSaved).toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  it('未选考试但名称匹配已有考试时复用该考试', async () => {
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    await act(async () => {
      result.current.setSelectedSubjectId('chinese')
    })
    act(() => {
      result.current.setExamNameInput('期末考试') // 匹配 exam-2
      result.current.updateSingleScore('张三', 'score', '93')
    })
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(apiMock.academic.createExam).not.toHaveBeenCalled()
    const records = apiMock.academic.batchSetGrades.mock.calls[0][0]
    expect(records[0].examId).toBe('exam-2')
    expect(result.current.selectedExamId).toBe('exam-2')
  })

  it('未选考试且无匹配时自动创建考试', async () => {
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    await act(async () => {
      result.current.setSelectedSubjectId('chinese')
    })
    act(() => {
      result.current.updateSingleScore('张三', 'score', '93')
    })
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(apiMock.academic.createExam).toHaveBeenCalledTimes(1)
    const created = apiMock.academic.createExam.mock.calls[0][0]
    expect(created.type).toBe('other')
    expect(created.subjects).toEqual(['chinese', 'math'])
    expect(created.semester).toMatch(/^\d{4}-\d{4}-[12]$/)
    const records = apiMock.academic.batchSetGrades.mock.calls[0][0]
    expect(records[0].examId).toBe('exam-new')
    expect(props.onExamCreated).toHaveBeenCalled()
  })

  it('自动创建考试失败时不保存成绩', async () => {
    apiMock.academic.createExam.mockResolvedValue({ success: false, error: 'db locked' })
    const toastSpy = vi.spyOn(toast, 'error')
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    await act(async () => {
      result.current.setSelectedSubjectId('chinese')
    })
    act(() => {
      result.current.updateSingleScore('张三', 'score', '93')
    })
    await act(async () => {
      await result.current.handleSaveSingle()
    })
    expect(apiMock.academic.batchSetGrades).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalled()
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  // ---------- handleSaveAll ----------

  it('全科保存: 未选学生报错', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup({ studentName: '' })
    await act(async () => {
      result.current.setMode('all-subjects')
    })
    await act(async () => {
      await result.current.handleSaveAll()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.batchSetGrades).not.toHaveBeenCalled()
  })

  it('全科保存: 记录按科目构建并带 examId', async () => {
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    await act(async () => {
      result.current.setMode('all-subjects')
      result.current.setSelectedExamId('exam-1')
    })
    act(() => {
      result.current.updateAllScore('chinese', 'score', '91')
      result.current.updateAllScore('math', 'score', '94')
      result.current.updateAllScore('math', 'rank', '7')
    })
    await act(async () => {
      await result.current.handleSaveAll()
    })
    const records = apiMock.academic.batchSetGrades.mock.calls[0][0]
    expect(records).toHaveLength(2)
    expect(records.find((r: { subjectId: string }) => r.subjectId === 'chinese')).toMatchObject({
      examId: 'exam-1',
      studentName: '张三',
      score: 91,
      fullMark: 150,
    })
    expect(records.find((r: { subjectId: string }) => r.subjectId === 'math')).toMatchObject({
      score: 94,
      classRank: 7,
    })
    expect(props.onSaved).toHaveBeenCalled()
  })

  it('全科保存 IPC 抛错时报错且 saving 复位', async () => {
    apiMock.academic.batchSetGrades.mockRejectedValue(new Error('network'))
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    await act(async () => {
      result.current.setMode('all-subjects')
      result.current.setSelectedExamId('exam-1')
    })
    act(() => {
      result.current.updateAllScore('chinese', 'score', '91')
    })
    await act(async () => {
      await result.current.handleSaveAll()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  // ---------- handleQuickCreate ----------

  it('快速建考试: 空名称报错', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    await act(async () => {
      await result.current.handleQuickCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.academic.createExam).not.toHaveBeenCalled()
  })

  it('快速建考试: 成功后选中新考试并复位表单', async () => {
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    act(() => {
      result.current.setQuickName('  月考一  ')
      result.current.setQuickType('monthly')
      result.current.setQuickDate('2025-10-05')
    })
    await act(async () => {
      await result.current.handleQuickCreate()
    })
    const created = apiMock.academic.createExam.mock.calls[0][0]
    expect(created.name).toBe('月考一') // trim
    expect(created.type).toBe('monthly')
    expect(created.date).toBe('2025-10-05')
    expect(props.onExamCreated).toHaveBeenCalled()
    expect(result.current.selectedExamId).toBe('exam-new')
    expect(result.current.showQuickCreate).toBe(false)
    expect(result.current.quickName).toBe('')
    expect(result.current.quickCreating).toBe(false)
  })

  it('快速建考试: 日期为空时用今天', async () => {
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    act(() => {
      result.current.setQuickName('随堂练')
    })
    await act(async () => {
      await result.current.handleQuickCreate()
    })
    const created = apiMock.academic.createExam.mock.calls[0][0]
    expect(created.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('快速建考试: IPC 抛错时报错且复位 creating', async () => {
    apiMock.academic.createExam.mockRejectedValue(new Error('boom'))
    const toastSpy = vi.spyOn(toast, 'error')
    const props = defaultArgs()
    const { result } = renderHook(() => useGradeEntry(props))
    act(() => {
      result.current.setQuickName('月考')
    })
    await act(async () => {
      await result.current.handleQuickCreate()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.quickCreating).toBe(false)
    expect(props.onExamCreated).not.toHaveBeenCalled()
  })

  // ---------- handleAIParse ----------

  it('AI 解析: 空文本报错且不调用模型', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const { result } = setup()
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.ai.chat).not.toHaveBeenCalled()
  })

  it('AI 解析: 未配置模型报错', async () => {
    const toastSpy = vi.spyOn(toast, 'error')
    const { result } = setup()
    act(() => {
      result.current.setAiInputText('张三 90')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(apiMock.ai.chat).not.toHaveBeenCalled()
  })

  it('AI 解析: 流式接收并填充 singleScores', async () => {
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const { result, unmount } = setup()
    act(() => {
      result.current.setAiInputText('张三 90分 第2名')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(result.current.aiParsing).toBe(true)
    expect(apiMock.ai.onStream).toHaveBeenCalled()
    const cb = apiMock.ai.onStream.mock.calls[0][0] as (e: unknown) => void

    // 其他 session 的事件应被忽略
    act(() => {
      cb({ type: 'text_delta', delta: 'ignored', sessionId: 'other' })
    })

    act(() => {
      cb({ type: 'text_delta', delta: '[{"name":"张三","score":90', sessionId: 'sess-1' })
      cb({ type: 'text_delta', delta: ',"rank":2}]', sessionId: 'sess-1' })
    })
    expect(result.current.aiProgress).toContain('已接收')

    const toastSpy = vi.spyOn(toast, 'success')
    act(() => {
      cb({ type: 'done', sessionId: 'sess-1' })
    })
    expect(result.current.aiParsing).toBe(false)
    expect(result.current.singleScores['张三']).toEqual({ score: '90', rank: '2' })
    expect(toastSpy).toHaveBeenCalled()
    unmount()
  })

  it('AI 解析: 格式错误时提示失败', async () => {
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const { result, unmount } = setup()
    act(() => {
      result.current.setAiInputText('随便一段文本')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    const cb = apiMock.ai.onStream.mock.calls[0][0] as (e: unknown) => void
    act(() => {
      cb({ type: 'text_delta', delta: '没有JSON数组', sessionId: 'sess-1' })
      cb({ type: 'done', sessionId: 'sess-1' })
    })
    expect(result.current.aiParsing).toBe(false)
    expect(result.current.aiProgress).toContain('格式异常')
    unmount()
  })

  it('AI 解析: 流 error 事件停止解析并提示', async () => {
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const { result, unmount } = setup()
    act(() => {
      result.current.setAiInputText('张三 90')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    const cb = apiMock.ai.onStream.mock.calls[0][0] as (e: unknown) => void
    act(() => {
      cb({ type: 'error', message: 'model overloaded', sessionId: 'sess-1' })
    })
    expect(result.current.aiParsing).toBe(false)
    expect(result.current.aiProgress).toContain('model overloaded')
    unmount()
  })

  it('AI 解析: ai.chat 调用失败时报错', async () => {
    apiMock.ai.chat.mockRejectedValue(new Error('quota exceeded'))
    const toastSpy = vi.spyOn(toast, 'error')
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const { result, unmount } = setup()
    act(() => {
      result.current.setAiInputText('张三 90')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(toastSpy).toHaveBeenCalled()
    expect(result.current.aiParsing).toBe(false)
    expect(result.current.aiProgress).toContain('quota exceeded')
    unmount()
  })

  it('卸载时取消流订阅,不触发 unsub 泄漏', async () => {
    useChatStore.setState({ currentProvider: 'p1', currentModel: 'm1' })
    const unsub = vi.fn()
    apiMock.ai.onStream.mockReturnValue(unsub)
    const { result, unmount } = setup()
    act(() => {
      result.current.setAiInputText('张三 90')
    })
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(unsub).not.toHaveBeenCalled() // 30s 定时器未到,未主动取消
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1) // R112: 卸载立即取消
  })
})
