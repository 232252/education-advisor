// =============================================================
// 学业指标纯函数 — metrics.ts 契约测试(共享层唯一事实来源)
// 覆盖: 平均分口径统一(0 分计入,仅缺考 null 排除 — 与
//       computeExamAverage 同口径,回归锚点)、偏科分析排序、
//       过滤/排序纯函数、趋势数据构建、对比构建前置条件
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAStudent, ExamDef, GradeRecord } from '@shared/types'
import {
  analyzeSubjects,
  buildComparison,
  buildTrendData,
  calcSubjectAvg,
  computeExamAverage,
  computeStudentComparisons,
  extractSemesters,
  filterExamsWithGrades,
  filterStudents,
  mergeExamSubjects,
  sortByDateAsc,
} from '../../../src/renderer/lib/academics/metrics'

const grade = (overrides: Partial<GradeRecord>): GradeRecord =>
  ({
    examId: 'e1',
    subjectId: 'chinese',
    studentName: '张三',
    score: null,
    updatedAt: 0,
    ...overrides,
  }) as GradeRecord

const exam = (id: string, name: string, date: string, semester = '2025-2026-1'): ExamDef =>
  ({ id, name, date, semester }) as ExamDef

describe('平均分口径', () => {
  it('calcSubjectAvg: 0 分计入平均(仅排除缺考 null 与其他科目)', () => {
    const grades = [
      grade({ subjectId: 'chinese', score: 90 }),
      grade({ subjectId: 'chinese', score: 0 }),
      grade({ subjectId: 'chinese', score: null }), // 缺考
      grade({ subjectId: 'math', score: 100 }), // 其他科目
    ]
    expect(calcSubjectAvg(grades, 'chinese')).toBe(45)
  })

  it('calcSubjectAvg: 全部缺考返回 null', () => {
    expect(calcSubjectAvg([grade({ score: null })], 'chinese')).toBeNull()
    expect(calcSubjectAvg([], 'chinese')).toBeNull()
  })

  it('analyzeSubjects: 0 分计入;降序排列 strongest/weakest', () => {
    const res = analyzeSubjects([
      grade({ subjectId: 'chinese', score: 80 }),
      grade({ subjectId: 'chinese', score: 60 }),
      grade({ subjectId: 'math', score: 0 }),
      grade({ subjectId: 'english', score: null }),
    ])
    expect(res.strongest).toMatchObject({ subjectId: 'chinese', avg: 70 })
    expect(res.weakest).toMatchObject({ subjectId: 'math', avg: 0 })
    expect(res.all.map((s) => s.subjectId)).toEqual(['chinese', 'math'])
  })

  it('computeExamAverage: null 不计入;全 null 按文档语义返回 NaN(调用方 UI 有 some(score!=null) 守卫)', () => {
    expect(computeExamAverage([grade({ score: 80 }), grade({ score: null })])).toBe(80)
    expect(Number.isNaN(computeExamAverage([grade({ score: null })]))).toBe(true)
    expect(computeExamAverage([])).toBe(0)
  })
})

describe('过滤与排序纯函数', () => {
  it('sortByDateAsc: 升序且不改原数组', () => {
    const arr = [exam('b', '期中', '2026-03-01'), exam('a', '开学', '2026-02-01')]
    const sorted = sortByDateAsc(arr)
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b'])
    expect(arr[0].id).toBe('b')
  })

  it('filterStudents: 剔除 Deleted + 班级筛选 + 搜索词', () => {
    const students = [
      { name: '张三', class_id: 'c1', status: 'Active' },
      { name: '李四', class_id: 'c2', status: 'Deleted' },
      { name: '王五', class_id: 'c1', status: 'Active' },
    ] as unknown as EAAStudent[]
    const res = filterStudents(students, 'c1', '张')
    expect(res.map((s) => s.name)).toEqual(['张三'])
  })

  it('extractSemesters: 去重降序;filterExamsWithGrades 只留实际参加的考试', () => {
    const exams = [exam('a', 'A', '2026-01', '2025-2026-1'), exam('b', 'B', '2026-02', '2024-2025-2')]
    expect(extractSemesters([...exams, exam('c', 'C', '2026-03', '2025-2026-1')])).toEqual([
      '2025-2026-1',
      '2024-2025-2',
    ])
    // 有实际分数的考试才列出;纯 null 缺考占位(幽灵成绩)不列
    const res = filterExamsWithGrades(exams, [
      grade({ examId: 'b', score: 88 }),
      grade({ examId: 'a' }),
    ])
    expect(res.map((e) => e.id)).toEqual(['b'])
  })
})

describe('趋势与对比构建', () => {
  it('buildTrendData: 无考试返回 null;全 null 的科目序列被剔除;缺失场次留 null 空洞', () => {
    expect(buildTrendData([], {})).toBeNull()
    const exams = [exam('e1', '月考一', '2026-01-01'), exam('e2', '月考二', '2026-02-01')]
    const res = buildTrendData(exams, {
      e1: [grade({ subjectId: 'chinese', score: 90 }), grade({ subjectId: 'math', score: 80 })],
      e2: [grade({ subjectId: 'chinese', score: 85 })], // math 未考
    })
    expect(res?.labels).toEqual(['月考一', '月考二'])
    // series.name 经 ACADEMIC_SUBJECT_MAP 映射为中文名;缺失场次留 null 空洞(有非空值则保留)
    expect(res?.series).toEqual([
      { name: '语文', data: [90, 85] },
      { name: '数学', data: [80, null] },
    ])
  })

  it('buildComparison: 考试 id 缺失/相同/两边都无成绩 → null', () => {
    const gradesByExam = { e1: [grade({ score: 90 })], e2: [grade({ score: 70 })] }
    expect(buildComparison(gradesByExam, '', 'e2', null, '张三')).toBeNull()
    expect(buildComparison(gradesByExam, 'e1', 'e1', null, '张三')).toBeNull()
    expect(buildComparison({}, 'e1', 'e2', null, '张三')).toBeNull()
    expect(buildComparison(gradesByExam, 'e1', 'e2', null, '张三')).not.toBeNull()
  })

  it('computeStudentComparisons: 按 totalScoreDelta 降序,null 排末尾', () => {
    // 通过 conductEvents 聚合路径验证排序: A 进步,B 无 delta 数据
    const comps = computeStudentComparisons(
      { 张三: [grade({ studentName: '张三', score: 60 })], 李四: [grade({ studentName: '李四', score: null })] },
      { 张三: [grade({ studentName: '张三', score: 90 })], 李四: [grade({ studentName: '李四', score: null })] },
      null,
      ['张三', '李四'],
      {},
    )
    expect(comps[0]?.studentName ?? comps[0]?.name).toBeDefined()
    for (let i = 1; i < comps.length; i++) {
      const prev = (comps[i - 1].totalScoreDelta ?? -Infinity) as number
      const cur = (comps[i].totalScoreDelta ?? -Infinity) as number
      expect(prev).toBeGreaterThanOrEqual(cur)
    }
  })
})

describe('mergeExamSubjects — 目录外科目补齐', () => {
  const catalog = [
    { id: 'chinese', name: '语文', category: 'core', fullMark: 150 },
    { id: 'math', name: '数学', category: 'science', fullMark: 150 },
  ]

  it('考试科目全在目录 → 原样返回(不追加)', () => {
    const merged = mergeExamSubjects(catalog, [{ subjects: ['chinese'] }])
    expect(merged).toBe(catalog)
  })

  it('目录外科目(如 AI 导入的「通用技术」)追加为临时科目,fullMark 取成绩记录', () => {
    const merged = mergeExamSubjects(
      catalog,
      [{ subjects: ['chinese', '通用技术'] }],
      [grade({ subjectId: '通用技术', score: 96, fullMark: 100 })],
    )
    expect(merged).toHaveLength(3)
    expect(merged[2]).toMatchObject({ id: '通用技术', name: '通用技术', fullMark: 100 })
  })

  it('成绩无 fullMark → 缺省 100;同科目跨考试去重', () => {
    const merged = mergeExamSubjects(catalog, [
      { subjects: ['通用技术'] },
      { subjects: ['通用技术'] },
    ])
    expect(merged).toHaveLength(3)
    expect(merged[2]?.fullMark).toBe(100)
  })

  it('只合并传入考试范围的科目 — 不相关考试的题段科目不进目录', () => {
    const merged = mergeExamSubjects(catalog, [{ subjects: ['chinese'] }], [
      grade({ subjectId: '1.一、单项选择题', score: 20, fullMark: 28 }),
    ])
    expect(merged).toBe(catalog)
  })
})

describe('mergeExamSubjects — extraSubjectIds(全部考试口径)', () => {
  it('无单场考试参照时,按成绩记录里的科目 id 补齐目录', () => {
    const merged = mergeExamSubjects(
      [{ id: 'chinese', name: '语文', category: 'core', fullMark: 150 }],
      [],
      [grade({ subjectId: '通用技术', score: 96, fullMark: 100 })],
      ['通用技术'],
    )
    expect(merged.map((s) => s.id)).toEqual(['chinese', '通用技术'])
    expect(merged[1]?.fullMark).toBe(100)
  })
})
