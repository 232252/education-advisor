// =============================================================
// grade-entry 单元测试 — 成绩录入纯函数
// 覆盖: gradeToEntry / buildSingleScores / buildAllScores /
//       buildScoresFromClassGrades / getActiveStudentsSorted /
//       getActiveStudentNames / buildAIGradeSystemPrompt /
//       parseAIGradesText / buildSingleSaveRecords / buildAllSaveRecords
// =============================================================

import { describe, expect, it } from 'vitest'
import type { EAAStudent, GradeRecord, SubjectDef } from '@shared/types'
import {
  buildAIGradeSystemPrompt,
  buildAllSaveRecords,
  buildAllScores,
  buildScoresFromClassGrades,
  buildSingleSaveRecords,
  buildSingleScores,
  getActiveStudentNames,
  getActiveStudentsSorted,
  gradeToEntry,
  parseAIGradesText,
} from '../../../../src/renderer/pages/Academics/lib/grade-entry'

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

// ---------- gradeToEntry ----------

describe('gradeToEntry', () => {
  it('score/classRank 转字符串', () => {
    expect(gradeToEntry(makeGrade({ score: 90, classRank: 3 }))).toEqual({
      score: '90',
      rank: '3',
    })
  })

  it('score 为 null 回退空串', () => {
    expect(gradeToEntry(makeGrade({ score: null })).score).toBe('')
  })

  it('classRank 缺失回退空串', () => {
    expect(gradeToEntry(makeGrade({ classRank: undefined })).rank).toBe('')
  })
})

// ---------- buildSingleScores ----------

describe('buildSingleScores', () => {
  it('只收集指定考试+科目的记录,按学生名索引', () => {
    const grades = [
      makeGrade({ studentName: '张三', examId: 'e1', subjectId: 'chinese', score: 90, classRank: 2 }),
      makeGrade({ studentName: '李四', examId: 'e1', subjectId: 'chinese', score: 85 }),
      makeGrade({ studentName: '王五', examId: 'e2', subjectId: 'chinese', score: 70 }), // 其他考试
      makeGrade({ studentName: '赵六', examId: 'e1', subjectId: 'math', score: 60 }), // 其他科目
    ]
    const scores = buildSingleScores(grades, 'e1', 'chinese')
    expect(Object.keys(scores).sort()).toEqual(['张三', '李四'])
    expect(scores['张三']).toEqual({ score: '90', rank: '2' })
    expect(scores['李四']).toEqual({ score: '85', rank: '' })
  })

  it('无匹配返回空对象', () => {
    expect(buildSingleScores([], 'e1', 'chinese')).toEqual({})
    expect(buildSingleScores([makeGrade()], 'nope', 'chinese')).toEqual({})
  })
})

// ---------- buildAllScores ----------

describe('buildAllScores', () => {
  it('只收集指定考试+学生的记录,按科目索引', () => {
    const grades = [
      makeGrade({ studentName: '张三', examId: 'e1', subjectId: 'chinese', score: 90 }),
      makeGrade({ studentName: '张三', examId: 'e1', subjectId: 'math', score: 95, classRank: 1 }),
      makeGrade({ studentName: '李四', examId: 'e1', subjectId: 'chinese', score: 80 }), // 其他学生
      makeGrade({ studentName: '张三', examId: 'e2', subjectId: 'math', score: 70 }), // 其他考试
    ]
    const scores = buildAllScores(grades, 'e1', '张三')
    expect(Object.keys(scores).sort()).toEqual(['chinese', 'math'])
    expect(scores['chinese']).toEqual({ score: '90', rank: '' })
    expect(scores['math']).toEqual({ score: '95', rank: '1' })
  })

  it('无匹配返回空对象', () => {
    expect(buildAllScores([], 'e1', '张三')).toEqual({})
  })
})

// ---------- buildScoresFromClassGrades ----------

describe('buildScoresFromClassGrades', () => {
  it('取每个学生的首条记录构建映射', () => {
    const classGrades = {
      张三: [makeGrade({ studentName: '张三', score: 90 }), makeGrade({ studentName: '张三', score: 95 })],
      李四: [makeGrade({ studentName: '李四', score: 80, classRank: 4 })],
    }
    const scores = buildScoresFromClassGrades(classGrades)
    expect(scores['张三']).toEqual({ score: '90', rank: '' })
    expect(scores['李四']).toEqual({ score: '80', rank: '4' })
  })

  it('空数组学生被跳过', () => {
    const scores = buildScoresFromClassGrades({ 张三: [], 李四: [makeGrade({ studentName: '李四' })] })
    expect(Object.keys(scores)).toEqual(['李四'])
  })

  it('null 数组学生被跳过', () => {
    const scores = buildScoresFromClassGrades({ 张三: null as unknown as GradeRecord[] })
    expect(scores).toEqual({})
  })

  it('空对象返回空对象', () => {
    expect(buildScoresFromClassGrades({})).toEqual({})
  })
})

// ---------- getActiveStudentsSorted / getActiveStudentNames ----------

describe('getActiveStudentsSorted', () => {
  it('过滤 Deleted 并按姓名排序', () => {
    const students = [
      makeStudent({ name: 'Charlie' }),
      makeStudent({ name: 'Alice' }),
      makeStudent({ name: 'Bob', status: 'Deleted' }),
    ]
    expect(getActiveStudentsSorted(students).map((s) => s.name)).toEqual(['Alice', 'Charlie'])
  })

  it('不修改输入数组顺序', () => {
    const students = [makeStudent({ name: 'B' }), makeStudent({ name: 'A' })]
    getActiveStudentsSorted(students)
    expect(students.map((s) => s.name)).toEqual(['B', 'A'])
  })

  it('空数组返回空数组', () => {
    expect(getActiveStudentsSorted([])).toEqual([])
  })
})

describe('getActiveStudentNames', () => {
  it('返回未删除学生姓名(保持原顺序)', () => {
    const students = [
      makeStudent({ name: 'B' }),
      makeStudent({ name: 'A' }),
      makeStudent({ name: 'C', status: 'Deleted' }),
    ]
    expect(getActiveStudentNames(students)).toEqual(['B', 'A'])
  })

  it('空数组返回空数组', () => {
    expect(getActiveStudentNames([])).toEqual([])
  })
})

// ---------- buildAIGradeSystemPrompt ----------

describe('buildAIGradeSystemPrompt', () => {
  it('内嵌学生名单与 JSON 格式要求', () => {
    const prompt = buildAIGradeSystemPrompt(['张三', '李四'])
    expect(prompt).toContain('张三、李四')
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('name')
    expect(prompt).toContain('score')
  })

  it('空名单仍生成合法 prompt', () => {
    const prompt = buildAIGradeSystemPrompt([])
    expect(prompt).toContain('学生名单(只解析这些学生): ')
    expect(typeof prompt).toBe('string')
  })
})

// ---------- parseAIGradesText ----------

describe('parseAIGradesText', () => {
  const names = ['张三', '李四', '王小明']

  it('正常解析 JSON 数组并精确匹配姓名', () => {
    const text = '以下是解析结果:\n[{"name":"张三","score":90,"rank":3},{"name":"李四","score":85}]'
    const result = parseAIGradesText(text, names)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matched).toBe(2)
    expect(result.scores['张三']).toEqual({ score: '90', rank: '3' })
    expect(result.scores['李四']).toEqual({ score: '85', rank: '' })
  })

  it('模糊匹配: 名单名包含文本名', () => {
    const result = parseAIGradesText('[{"name":"王小","score":77}]', names)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scores['王小明']).toEqual({ score: '77', rank: '' })
  })

  it('模糊匹配: 文本名包含名单名', () => {
    const result = parseAIGradesText('[{"name":"王小明同学","score":66}]', names)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scores['王小明']).toEqual({ score: '66', rank: '' })
  })

  it('不在名单的学生被忽略', () => {
    const result = parseAIGradesText('[{"name":"赵九","score":99}]', names)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matched).toBe(0)
    expect(result.scores).toEqual({})
  })

  it('缺少 name 或 score 的条目被跳过', () => {
    const result = parseAIGradesText('[{"score":90},{"name":"张三"}]', names)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matched).toBe(0)
  })

  it('无 JSON 数组返回 format 错误', () => {
    const result = parseAIGradesText('抱歉,我无法解析这段文本。', names)
    expect(result).toEqual({ ok: false, reason: 'format' })
  })

  it('JSON 语法错误返回 json 错误', () => {
    const result = parseAIGradesText('[{"name":"张三","score":}]', names)
    expect(result).toEqual({ ok: false, reason: 'json' })
  })

  it('空文本返回 format 错误', () => {
    expect(parseAIGradesText('', names)).toEqual({ ok: false, reason: 'format' })
  })
})

// ---------- buildSingleSaveRecords ----------

describe('buildSingleSaveRecords', () => {
  const subject: SubjectDef = { id: 'chinese', name: '语文', category: 'core', fullMark: 150 }

  it('过滤空分数条目并构建记录', () => {
    const singleScores = {
      张三: { score: '90', rank: '3' },
      李四: { score: '85', rank: '' },
      王五: { score: '', rank: '1' }, // 空分数被过滤
    }
    const records = buildSingleSaveRecords(singleScores, 'chinese', subject)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      examId: '',
      subjectId: 'chinese',
      studentName: '张三',
      score: 90,
      fullMark: 150,
      classRank: 3,
    })
    expect(records[1]).toMatchObject({ studentName: '李四', score: 85, classRank: undefined })
  })

  it('非法数字回退 null/undefined', () => {
    const records = buildSingleSaveRecords(
      { 张三: { score: 'abc', rank: 'xyz' } },
      'chinese',
      subject,
    )
    expect(records[0].score).toBeNull()
    expect(records[0].classRank).toBeUndefined()
  })

  it('全部为空返回空数组', () => {
    expect(buildSingleSaveRecords({ 张三: { score: '', rank: '' } }, 'chinese', subject)).toEqual([])
    expect(buildSingleSaveRecords({}, 'chinese', subject)).toEqual([])
  })
})

// ---------- buildAllSaveRecords ----------

describe('buildAllSaveRecords', () => {
  const subjectMap: Record<string, SubjectDef> = {
    chinese: { id: 'chinese', name: '语文', category: 'core', fullMark: 150 },
    math: { id: 'math', name: '数学', category: 'core', fullMark: 150 },
  }

  it('按科目构建记录,科目缺失时满分回退 100', () => {
    const allScores = {
      chinese: { score: '90', rank: '2' },
      pe: { score: '45', rank: '' }, // subjectMap 中不存在
      math: { score: '', rank: '' }, // 空分数被过滤
    }
    const records = buildAllSaveRecords(allScores, '张三', subjectMap)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      examId: '',
      subjectId: 'chinese',
      studentName: '张三',
      score: 90,
      fullMark: 150,
      classRank: 2,
    })
    expect(records[1]).toMatchObject({ subjectId: 'pe', score: 45, fullMark: 100 })
  })

  it('全部为空返回空数组', () => {
    expect(buildAllSaveRecords({}, '张三', subjectMap)).toEqual([])
    expect(
      buildAllSaveRecords({ chinese: { score: '', rank: '' } }, '张三', subjectMap),
    ).toEqual([])
  })
})
