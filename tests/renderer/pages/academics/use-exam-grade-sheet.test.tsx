// =============================================================
// useExamGradeSheet — 打印成绩单数据组装测试
// 覆盖: printSheet 成功链路(IPC → 行构建 → 科目统计)、竞争排名
//       (同分同名次 1,2,2)、success:false 空成绩、IPC 异常 toast、
//       空名单不发请求、closeSheet 清空、loading 态
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { toastMocks } from '../../helpers/mock-toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'

const mocks = vi.hoisted(() => ({
  getClassGrades: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    academic: { getClassGrades: mocks.getClassGrades },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', async () => (await import('../../helpers/mock-toast')).mockToastStore)

import { useExamGradeSheet } from '../../../../src/renderer/pages/Academics/hooks/useExamGradeSheet'

const student = (name: string): Pick<EAAStudent, 'name' | 'class_id'> =>
  ({ name, class_id: 'c1' }) as Pick<EAAStudent, 'name' | 'class_id'>

const grade = (studentName: string, subjectId: string, score: number | null): GradeRecord =>
  ({ examId: 'e1', subjectId, studentName, score, updatedAt: 0 }) as GradeRecord

const exam = {
  id: 'e1',
  name: '月考一',
  date: '2026-09-01',
  subjects: ['chinese', 'math'],
} as unknown as ExamDef

const hook = () =>
  renderHook(() =>
    useExamGradeSheet([student('张三'), student('李四'), student('王五')]),
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('printSheet 成功链路', () => {
  it('拉取班级成绩并组装行/排名/科目统计', async () => {
    mocks.getClassGrades.mockResolvedValue({
      success: true,
      data: {
        张三: [grade('张三', 'chinese', 90), grade('张三', 'math', 80)],
        李四: [grade('李四', 'chinese', 90), grade('李四', 'math', 80)],
        王五: [grade('王五', 'chinese', 70), grade('王五', 'math', null)],
      },
    })
    const { result } = hook()
    await act(async () => {
      await result.current.printSheet(exam)
    })
    expect(mocks.getClassGrades).toHaveBeenCalledWith(['张三', '李四', '王五'], 'e1')
    expect(result.current.loading).toBe(false)
    const sheet = result.current.sheet
    expect(sheet).not.toBeNull()
    // 竞争排名: 张三/李四同总分 170 并列第 1,王五 70 第 3
    expect(sheet!.rows.map((r) => [r.name, r.total, r.rank])).toEqual([
      ['张三', 170, 1],
      ['李四', 170, 1],
      ['王五', 70, 3],
    ])
    // 科目统计: 数学王五缺考不计入
    const math = sheet!.subjectStats.find((s) => s.subjectId === 'math')
    expect(math).toMatchObject({ count: 2, average: 80, max: 80, min: 80 })
    const chinese = sheet!.subjectStats.find((s) => s.subjectId === 'chinese')
    expect(chinese).toMatchObject({ count: 3, average: 83.3 })
  })

  it('success:false → 全空成绩行(无排名),仍出表', async () => {
    mocks.getClassGrades.mockResolvedValue({ success: false })
    const { result } = hook()
    await act(async () => {
      await result.current.printSheet(exam)
    })
    const sheet = result.current.sheet
    expect(sheet).not.toBeNull()
    expect(sheet!.rows).toHaveLength(3)
    expect(sheet!.rows.every((r) => r.total == null && r.rank == null)).toBe(true)
  })
})

describe('异常与边界', () => {
  it('IPC 异常 → toast 且不出表、loading 复位', async () => {
    mocks.getClassGrades.mockRejectedValue(new Error('db locked'))
    const { result } = hook()
    await act(async () => {
      await result.current.printSheet(exam)
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(result.current.sheet).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('名单为空 → 不发请求直接出空表', async () => {
    const { result } = renderHook(() => useExamGradeSheet([]))
    await act(async () => {
      await result.current.printSheet(exam)
    })
    expect(mocks.getClassGrades).not.toHaveBeenCalled()
    expect(result.current.sheet).not.toBeNull()
    expect(result.current.sheet!.rows).toHaveLength(0)
  })

  it('closeSheet 清空当前表', async () => {
    mocks.getClassGrades.mockResolvedValue({ success: true, data: { 张三: [grade('张三', 'chinese', 90)] } })
    const { result } = hook()
    await act(async () => {
      await result.current.printSheet(exam)
    })
    expect(result.current.sheet).not.toBeNull()
    act(() => result.current.closeSheet())
    expect(result.current.sheet).toBeNull()
  })

  it('目录外科目(如 AI 导入的「通用技术」)补齐进成绩单科目,预览不再丢列', async () => {
    mocks.getClassGrades.mockResolvedValue({
      success: true,
      data: { 张三: [{ ...grade('张三', '通用技术', 96), fullMark: 100 }] },
    })
    const customExam = { ...exam, subjects: ['通用技术'] } as unknown as ExamDef
    const catalog = [{ id: 'chinese', name: '语文', category: 'core', fullMark: 150 }]
    const { result } = renderHook(() =>
      useExamGradeSheet([student('张三')], catalog as SubjectDef[]),
    )
    await act(async () => {
      await result.current.printSheet(customExam)
    })
    const ids = result.current.sheet!.subjects.map((s) => s.id)
    expect(ids).toContain('chinese')
    expect(ids).toContain('通用技术')
    expect(result.current.sheet!.subjects.find((s) => s.id === '通用技术')?.fullMark).toBe(100)
  })

  it('loading 态在拉取期间为 true', async () => {
    let resolve!: (v: unknown) => void
    mocks.getClassGrades.mockImplementation(() => new Promise((res) => { resolve = res }))
    const { result } = hook()
    act(() => {
      void result.current.printSheet(exam)
    })
    expect(result.current.loading).toBe(true)
    await act(async () => {
      resolve({ success: true, data: {} })
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})
