// =============================================================
// academics-metrics 单元测试 — 学业模块纯计算函数
// 覆盖: sortByDateAsc / calcSubjectAvg / filterStudents /
//       extractSemesters / filterExamsWithGrades / buildGradeTableData /
//       filterStudentNamesByClass / computeStudentComparisons / SUBJECT_COLORS
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import {
  SUBJECT_COLORS,
  buildGradeTableData,
  calcSubjectAvg,
  computeStudentComparisons,
  extractSemesters,
  filterExamsWithGrades,
  filterStudentNamesByClass,
  filterStudents,
  sortByDateAsc,
} from '../../../../src/renderer/lib/academics'

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
    class_id: 'class-1',
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

// ---------- sortByDateAsc ----------

describe('sortByDateAsc', () => {
  it('按日期升序排序', () => {
    const input = [
      makeExam({ id: 'e3', date: '2025-12-01' }),
      makeExam({ id: 'e1', date: '2025-10-01' }),
      makeExam({ id: 'e2', date: '2025-11-01' }),
    ]
    const result = sortByDateAsc(input)
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('空数组返回空数组', () => {
    expect(sortByDateAsc([])).toEqual([])
  })

  it('date 缺失时按空串比较,排在最前', () => {
    const input = [
      { date: undefined as unknown as string, id: 'no-date' },
      { date: '2025-01-01', id: 'dated' },
    ]
    const result = sortByDateAsc(input)
    expect(result.map((x) => x.id)).toEqual(['no-date', 'dated'])
  })

  it('不修改输入数组', () => {
    const input = [makeExam({ date: '2025-12-01' }), makeExam({ date: '2025-01-01' })]
    const snapshot = input.map((e) => e.date)
    sortByDateAsc(input)
    expect(input.map((e) => e.date)).toEqual(snapshot)
  })
})

// ---------- calcSubjectAvg ----------

describe('calcSubjectAvg', () => {
  it('计算指定科目多次考试的平均分', () => {
    const grades = [
      makeGrade({ subjectId: 'math', score: 80 }),
      makeGrade({ subjectId: 'math', score: 90 }),
      makeGrade({ subjectId: 'chinese', score: 100 }),
    ]
    expect(calcSubjectAvg(grades, 'math')).toBe(85)
  })

  it('空数组返回 null', () => {
    expect(calcSubjectAvg([], 'math')).toBeNull()
  })

  it('无匹配科目返回 null', () => {
    const grades = [makeGrade({ subjectId: 'math', score: 80 })]
    expect(calcSubjectAvg(grades, 'english')).toBeNull()
  })

  it('score 为 null 或 0 的记录不计入平均', () => {
    const grades = [
      makeGrade({ subjectId: 'math', score: null }),
      makeGrade({ subjectId: 'math', score: 0 }),
      makeGrade({ subjectId: 'math', score: 100 }),
    ]
    expect(calcSubjectAvg(grades, 'math')).toBe(100)
  })

  it('全部无效分数返回 null', () => {
    const grades = [
      makeGrade({ subjectId: 'math', score: null }),
      makeGrade({ subjectId: 'math', score: 0 }),
    ]
    expect(calcSubjectAvg(grades, 'math')).toBeNull()
  })
})

// ---------- filterStudents ----------

describe('filterStudents', () => {
  const students: EAAStudent[] = [
    makeStudent({ name: '王五', class_id: 'class-1' }),
    makeStudent({ name: '李四', class_id: 'class-2' }),
    makeStudent({ name: '赵六', class_id: null }),
    makeStudent({ name: '孙七', class_id: 'class-1', status: 'Deleted' }),
  ]

  it('__ALL__ 保留全部未删除学生', () => {
    const result = filterStudents(students, '__ALL__', '')
    expect(result.map((s) => s.name).sort()).toEqual(['李四', '王五', '赵六'])
  })

  it('剔除 Deleted 状态学生', () => {
    const result = filterStudents(students, '__ALL__', '')
    expect(result.some((s) => s.name === '孙七')).toBe(false)
  })

  it('具体班级筛选', () => {
    const result = filterStudents(students, 'class-1', '')
    expect(result.map((s) => s.name)).toEqual(['王五'])
  })

  it('__NONE__ 只保留无班级学生', () => {
    const result = filterStudents(students, '__NONE__', '')
    expect(result.map((s) => s.name)).toEqual(['赵六'])
  })

  it('搜索词过滤(大小写不敏感)', () => {
    const enStudents = [
      makeStudent({ name: 'Alice', class_id: null }),
      makeStudent({ name: 'Bob', class_id: null }),
    ]
    expect(filterStudents(enStudents, '__ALL__', 'ali').map((s) => s.name)).toEqual(['Alice'])
    expect(filterStudents(enStudents, '__ALL__', 'BOB').map((s) => s.name)).toEqual(['Bob'])
  })

  it('搜索词自动 trim', () => {
    const enStudents = [makeStudent({ name: 'Alice', class_id: null })]
    expect(filterStudents(enStudents, '__ALL__', '  alice  ').map((s) => s.name)).toEqual(['Alice'])
  })

  it('结果按姓名排序', () => {
    const enStudents = [
      makeStudent({ name: 'Charlie', class_id: null }),
      makeStudent({ name: 'Alice', class_id: null }),
      makeStudent({ name: 'Bob', class_id: null }),
    ]
    expect(filterStudents(enStudents, '__ALL__', '').map((s) => s.name)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
    ])
  })

  it('班级 + 搜索词组合过滤', () => {
    const combined = [
      makeStudent({ name: 'Alice', class_id: 'class-1' }),
      makeStudent({ name: 'Alan', class_id: 'class-2' }),
      makeStudent({ name: 'Alana', class_id: 'class-1' }),
    ]
    expect(filterStudents(combined, 'class-1', 'al').map((s) => s.name)).toEqual([
      'Alana',
      'Alice',
    ])
  })

  it('空数组输入返回空数组', () => {
    expect(filterStudents([], '__ALL__', '')).toEqual([])
  })
})

// ---------- extractSemesters ----------

describe('extractSemesters', () => {
  it('去重并按降序排列(最新学期在前)', () => {
    const exams = [
      makeExam({ semester: '2025-2026-1' }),
      makeExam({ semester: '2024-2025-2' }),
      makeExam({ semester: '2025-2026-1' }),
      makeExam({ semester: '2025-2026-2' }),
    ]
    expect(extractSemesters(exams)).toEqual(['2025-2026-2', '2025-2026-1', '2024-2025-2'])
  })

  it('空数组返回空数组', () => {
    expect(extractSemesters([])).toEqual([])
  })

  it('跳过空 semester', () => {
    const exams = [makeExam({ semester: '' }), makeExam({ semester: '2025-2026-1' })]
    expect(extractSemesters(exams)).toEqual(['2025-2026-1'])
  })
})

// ---------- filterExamsWithGrades ----------

describe('filterExamsWithGrades', () => {
  it('只保留有关联成绩的考试,并按日期升序', () => {
    const exams = [
      makeExam({ id: 'e1', date: '2025-10-01' }),
      makeExam({ id: 'e2', date: '2025-11-01' }),
      makeExam({ id: 'e3', date: '2025-12-01' }),
    ]
    const grades = [makeGrade({ examId: 'e3' }), makeGrade({ examId: 'e1' })]
    const result = filterExamsWithGrades(exams, grades)
    expect(result.map((e) => e.id)).toEqual(['e1', 'e3'])
  })

  it('空成绩返回空数组', () => {
    const exams = [makeExam({ id: 'e1' })]
    expect(filterExamsWithGrades(exams, [])).toEqual([])
  })

  it('空考试返回空数组', () => {
    expect(filterExamsWithGrades([], [makeGrade()])).toEqual([])
  })
})

// ---------- buildGradeTableData ----------

describe('buildGradeTableData', () => {
  const subjects: SubjectDef[] = [
    { id: 'chinese', name: '语文', category: 'core', fullMark: 150 },
    { id: 'math', name: '数学', category: 'core', fullMark: 150 },
  ]

  it('输出按日期降序,行包含各科目成绩映射', () => {
    const exams = [
      makeExam({ id: 'e-old', date: '2025-10-01' }),
      makeExam({ id: 'e-new', date: '2025-12-01' }),
    ]
    const grades = [
      makeGrade({ examId: 'e-old', subjectId: 'chinese', score: 80 }),
      makeGrade({ examId: 'e-new', subjectId: 'chinese', score: 90 }),
      makeGrade({ examId: 'e-new', subjectId: 'math', score: 95, classRank: 3 }),
    ]
    const rows = buildGradeTableData(exams, grades, subjects)

    expect(rows.map((r) => r.exam.id)).toEqual(['e-new', 'e-old'])
    expect(rows[0].scoresBySubject.chinese?.score).toBe(90)
    expect(rows[0].scoresBySubject.math?.score).toBe(95)
    expect(rows[0].classRank).toBe(3)
  })

  it('缺失科目的单元格为 undefined', () => {
    const exams = [makeExam({ id: 'e1' })]
    const grades = [makeGrade({ examId: 'e1', subjectId: 'chinese', score: 80 })]
    const rows = buildGradeTableData(exams, grades, subjects)
    expect(rows[0].scoresBySubject.chinese?.score).toBe(80)
    expect(rows[0].scoresBySubject.math).toBeUndefined()
  })

  it('取第一个有 classRank 的记录作为该考试排名', () => {
    const exams = [makeExam({ id: 'e1' })]
    const grades = [
      makeGrade({ examId: 'e1', subjectId: 'chinese', score: 80, classRank: 5 }),
      makeGrade({ examId: 'e1', subjectId: 'math', score: 90, classRank: 2 }),
    ]
    const rows = buildGradeTableData(exams, grades, subjects)
    expect(rows[0].classRank).toBe(5)
  })

  it('无任何 classRank 时为 undefined', () => {
    const exams = [makeExam({ id: 'e1' })]
    const grades = [makeGrade({ examId: 'e1', score: 80 })]
    const rows = buildGradeTableData(exams, grades, subjects)
    expect(rows[0].classRank).toBeUndefined()
  })

  it('空考试返回空数组', () => {
    expect(buildGradeTableData([], [makeGrade()], subjects)).toEqual([])
  })
})

// ---------- filterStudentNamesByClass ----------

describe('filterStudentNamesByClass', () => {
  const students: EAAStudent[] = [
    makeStudent({ name: '王五', class_id: 'class-1' }),
    makeStudent({ name: '李四', class_id: 'class-2' }),
    makeStudent({ name: '赵六', class_id: null }),
    makeStudent({ name: '孙七', class_id: 'class-1', status: 'Deleted' }),
  ]

  it('__ALL__ 返回全部未删除学生姓名', () => {
    const names = filterStudentNamesByClass(students, '__ALL__')
    expect(names.sort()).toEqual(['李四', '王五', '赵六'])
  })

  it('具体班级筛选返回姓名', () => {
    expect(filterStudentNamesByClass(students, 'class-2')).toEqual(['李四'])
  })

  it('__NONE__ 只返回无班级学生姓名', () => {
    expect(filterStudentNamesByClass(students, '__NONE__')).toEqual(['赵六'])
  })

  it('空数组返回空数组', () => {
    expect(filterStudentNamesByClass([], '__ALL__')).toEqual([])
  })
})

// ---------- computeStudentComparisons ----------

describe('computeStudentComparisons', () => {
  const subjectNameMap = { chinese: '语文', math: '数学' }

  it('按 totalScoreDelta 降序排列(进步多的在前)', () => {
    const gradesA = {
      张三: [makeGrade({ studentName: '张三', score: 80 })],
      李四: [makeGrade({ studentName: '李四', score: 90 })],
    }
    const gradesB = {
      张三: [makeGrade({ studentName: '张三', score: 90 })],
      李四: [makeGrade({ studentName: '李四', score: 70 })],
    }
    const comps = computeStudentComparisons(gradesA, gradesB, null, ['张三', '李四'], subjectNameMap)
    expect(comps.map((c) => c.studentName)).toEqual(['张三', '李四'])
    expect(comps[0].totalScoreDelta).toBe(10)
    expect(comps[1].totalScoreDelta).toBe(-20)
  })

  it('conductEvents 为 null 时 conductDelta 为 null', () => {
    const comps = computeStudentComparisons(
      { 张三: [makeGrade({ studentName: '张三', score: 80 })] },
      { 张三: [makeGrade({ studentName: '张三', score: 85 })] },
      null,
      ['张三'],
      subjectNameMap,
    )
    expect(comps[0].conductDelta).toBeNull()
  })

  it('conductEvents 非空时聚合目标学生的操行分变化', () => {
    const events = [
      {
        event_id: 'ev1',
        name: '张三',
        entity_id: 'ent-1',
        timestamp: '2025-11-05T00:00:00Z',
        event_type: 'ConductBonus' as const,
        reason_code: 'rc',
        original_reason: 'help',
        score_delta: 3,
        note: '',
        tags: [],
        operator: 't',
        is_valid: true,
        reverted_by: null,
      },
      {
        event_id: 'ev2',
        name: '李四',
        entity_id: 'ent-2',
        timestamp: '2025-11-06T00:00:00Z',
        event_type: 'ConductDeduct' as const,
        reason_code: 'rc',
        original_reason: 'late',
        score_delta: -2,
        note: '',
        tags: [],
        operator: 't',
        is_valid: true,
        reverted_by: null,
      },
    ]
    const comps = computeStudentComparisons(
      { 张三: [makeGrade({ studentName: '张三', score: 80 })] },
      { 张三: [makeGrade({ studentName: '张三', score: 80 })] },
      events,
      ['张三'],
      subjectNameMap,
    )
    expect(comps[0].conductDelta).toBe(3)
  })

  it('totalScoreDelta 为 null 的学生排在最后', () => {
    const gradesA = {
      张三: [makeGrade({ studentName: '张三', score: 80 })],
    }
    const gradesB = {
      张三: [makeGrade({ studentName: '张三', score: 85 })],
      王五: [makeGrade({ studentName: '王五', score: 60 })],
    }
    const comps = computeStudentComparisons(gradesA, gradesB, null, [], subjectNameMap)
    expect(comps).toHaveLength(2)
    expect(comps[0].studentName).toBe('张三')
    expect(comps[0].totalScoreDelta).toBe(5)
    expect(comps[1].studentName).toBe('王五')
    expect(comps[1].totalScoreDelta).toBeNull()
  })

  it('空输入返回空数组', () => {
    expect(computeStudentComparisons({}, {}, null, [], subjectNameMap)).toEqual([])
  })
})

// ---------- SUBJECT_COLORS ----------

describe('SUBJECT_COLORS', () => {
  it('提供至少 10 种互不相同的颜色', () => {
    expect(SUBJECT_COLORS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(SUBJECT_COLORS).size).toBe(SUBJECT_COLORS.length)
    for (const c of SUBJECT_COLORS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
