// =============================================================
// 成绩表表头 / 考号≠学号匹配
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  findGradeSheetHeaderRow,
  matchGradeRowsToRoster,
  parseGradeSheetMatrix,
  resolveGradeSheetHeaders,
} from '../../src/shared/grade-sheet'
import { resolveRosterHeaders } from '../../src/shared/roster-profile'

describe('resolveGradeSheetHeaders', () => {
  it('识别姓名 + 科目列', () => {
    const h = resolveGradeSheetHeaders(['考号', '姓名', '学号', '语文', '数学', '英语'])
    expect(h).not.toBeNull()
    expect(h?.nameCol).toBe(1)
    expect(h?.examNumberCol).toBe(0)
    expect(h?.studentIdCol).toBe(2)
    expect(h?.subjectCols.chinese).toBe(3)
    expect(h?.subjectCols.math).toBe(4)
    expect(h?.subjectCols.english).toBe(5)
  })

  it('花名册没有分数列 → 不是成绩表', () => {
    expect(resolveGradeSheetHeaders(['序号', '姓名', '就读班级', '身份证号码'])).toBeNull()
  })

  it('考号不会被当成学号', () => {
    const h = resolveGradeSheetHeaders(['姓名', '考号', '语文'])
    expect(h?.studentIdCol).toBe(-1)
    expect(h?.examNumberCol).toBe(1)
  })
})

describe('findGradeSheetHeaderRow', () => {
  it('跳过标题行', () => {
    const found = findGradeSheetHeaderRow([
      ['高三5班第一次月考成绩'],
      ['考号', '姓名', '语文', '数学'],
      ['20261001', '罗尧骋', '120', '135'],
    ])
    expect(found?.rowIndex).toBe(1)
    expect(found?.nameCol).toBe(1)
  })
})

describe('parseGradeSheetMatrix + matchGradeRowsToRoster', () => {
  const matrix = [
    ['高三5班月考'],
    ['考号', '姓名', '学号', '语文', '数学'],
    ['20261001', '罗尧骋', '20240005', '120', '135'],
    ['20261099', '不存在的人', '999', '90', '90'],
    ['', '', '', '', ''],
  ]

  it('考号≠学号时按姓名匹配，不新建学生', () => {
    const parsed = parseGradeSheetMatrix(matrix)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]?.examNumber).toBe('20261001')
    expect(parsed.rows[0]?.studentNumber).toBe('20240005')

    const { matched, unmatched } = matchGradeRowsToRoster(parsed.rows, [
      { name: '罗尧骋', studentNumber: '20240005' },
    ])
    expect(matched).toHaveLength(1)
    expect(matched[0]?.matchedName).toBe('罗尧骋')
    expect(matched[0]?.matchedBy).toBe('name')
    expect(matched[0]?.warnings.some((w) => w.includes('考号'))).toBe(true)
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0]?.name).toBe('不存在的人')
    expect(unmatched[0]?.matchedName).toBeNull()
  })

  it('无姓名时可用学号或考号对上', () => {
    const parsed = parseGradeSheetMatrix([
      ['考号', '姓名', '学号', '语文'],
      ['EXAM-7', '', 'STU-7', '88'],
    ])
    const { matched, unmatched } = matchGradeRowsToRoster(parsed.rows, [
      { name: '阿的叶呷', studentNumber: 'STU-7', examNumber: 'EXAM-7' },
    ])
    expect(unmatched).toHaveLength(0)
    expect(matched[0]?.matchedName).toBe('阿的叶呷')
    expect(matched[0]?.matchedBy).toBe('student_number')
  })

  it('缺考记 null', () => {
    const parsed = parseGradeSheetMatrix([
      ['姓名', '语文'],
      ['罗尧骋', '缺考'],
    ])
    expect(parsed.rows[0]?.scores.chinese).toBeNull()
  })
})

describe('花名册考号列', () => {
  it('考号与学号分成两列', () => {
    const h = resolveRosterHeaders(['姓名', '学号', '考号'])
    expect(h?.studentId).toBe(1)
    expect(h?.examNumber).toBe(2)
  })
})
