// =============================================================
// useClassGradesAnalytics — 组合层集成测试
// 真 useMultiLoader/useExamPairSelection/纯函数族,假 academic API。
// 锁定: 班内优先自动选考试、单场/全部考试聚合口径、对比对默认
// 与进退统计、趋势点、enabled=false 零加载、reload 汇聚。
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamDef, GradeRecord } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listExams: vi.fn(),
  getConfig: vi.fn(),
  getClassGrades: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    academic: {
      listExams: mocks.listExams,
      getConfig: mocks.getConfig,
      getClassGrades: mocks.getClassGrades,
    },
  }),
}))

import { EXAM_FILTER_ALL } from '../../../../src/renderer/pages/Classes/lib/exam-scope'
import { useClassGradesAnalytics } from '../../../../src/renderer/pages/Classes/hooks/useClassGradesAnalytics'

function exam(id: string, date: string, classId?: string): ExamDef {
  return { id, name: 'N-' + id, date, classId, semester: 'S1' } as ExamDef
}

// 列表顺序刻意乱序: o1(别班,全局最近) / e1(本班最早) / e2(本班最近)
const EXAMS = [exam('o1', '2026-03-01', 'C9'), exam('e1', '2026-01-10', 'C1'), exam('e2', '2026-02-10', 'C1')]

const SCORES: Record<string, Record<string, number>> = {
  // examId → 学生 → 分
  e1: { 甲: 80, 乙: 70 },
  e2: { 甲: 90, 乙: 60 },
  o1: { 甲: 85, 乙: 65 },
}

function gradesOf(examId: string): Record<string, GradeRecord[]> {
  const out: Record<string, GradeRecord[]> = {}
  for (const [name, score] of Object.entries(SCORES[examId] ?? {})) {
    out[name] = [{ subjectId: 'math', score, fullMark: 100 } as GradeRecord]
  }
  return out
}

const STUDENTS = [{ name: '甲' }, { name: '乙' }].map((s) => ({ ...s, class_id: 'C1' }))

function setup(props?: Parameters<typeof useClassGradesAnalytics>[0]) {
  return renderHook((p: Parameters<typeof useClassGradesAnalytics>[0]) => useClassGradesAnalytics(p), {
    initialProps: props ?? { students: STUDENTS, classId: 'C1' },
  })
}

describe('useClassGradesAnalytics 组合层', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listExams.mockResolvedValue({ success: true, data: EXAMS })
    mocks.getConfig.mockResolvedValue({
      success: true,
      data: { subjects: [{ id: 'math', name: '数学' }] },
    })
    mocks.getClassGrades.mockImplementation(async (_names: string[], examId: string) => ({
      success: true,
      data: gradesOf(examId),
    }))
  })

  it('catalog 就绪 + 班内优先自动选考试(不落别班最近一场)', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.catalogReady).toBe(true))
    expect(result.current.examId).toBe('e2')
    expect(result.current.selectedExam?.name).toBe('N-e2')
    expect(result.current.subjects).toEqual([{ id: 'math', name: '数学' }])
    expect(result.current.exams.map((e) => e.id)).toEqual(['o1', 'e2', 'e1'])
  })

  it('单场成绩: 按学生名 + 选中考试拉取并就绪', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.classGrades['甲']).toHaveLength(1))
    expect(mocks.getClassGrades).toHaveBeenCalledWith(['甲', '乙'], 'e2')
    expect(result.current.classGrades['甲']).toHaveLength(1)
    expect(result.current.classGrades['甲'][0].score).toBe(90)
  })

  it('全部考试: 逐场拉取后按学生合并', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.classGrades['甲']).toHaveLength(1))
    act(() => {
      result.current.setExamId(EXAM_FILTER_ALL)
    })
    await waitFor(() =>
      expect(result.current.classGrades['甲']).toHaveLength(3),
    )
    const calledExamIds = mocks.getClassGrades.mock.calls.map((c) => c[1])
    expect(calledExamIds).toEqual(expect.arrayContaining(['o1', 'e1', 'e2']))
    expect(result.current.selectedExam).toBeNull()
  })

  it('对比对默认 A=倒数第二/B=最后(升序),进退统计落位', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.examAId).toBe('e2'))
    // 升序 [e1,e2,o1] → A=e2,B=o1;甲 90→85 降,乙 60→65 升
    expect(result.current.examAId).toBe('e2')
    expect(result.current.examBId).toBe('o1')
    expect(result.current.movement).toEqual({ improved: 1, declined: 1, flat: 0 })
  })

  it('趋势: 同学期池 3 场按日期升序出点', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.trendPoints).toHaveLength(3))
    expect(result.current.trendPoints.map((p) => p.examId)).toEqual(['e1', 'e2', 'o1'])
    // e1: 甲 80 乙 70 → 均值 75
    expect(result.current.trendPoints[0].average).toBe(75)
  })

  it('enabled=false: 零 API 调用', () => {
    const { result } = setup({ enabled: false, students: STUDENTS, classId: 'C1' })
    expect(result.current.exams).toEqual([])
    expect(mocks.listExams).not.toHaveBeenCalled()
    expect(mocks.getClassGrades).not.toHaveBeenCalled()
  })

  it('reload 汇聚四个加载器: catalog 重新拉取', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.catalogReady).toBe(true))
    const before = mocks.listExams.mock.calls.length
    act(() => {
      result.current.reload()
    })
    await waitFor(() => expect(mocks.listExams.mock.calls.length).toBeGreaterThan(before))
  })
})