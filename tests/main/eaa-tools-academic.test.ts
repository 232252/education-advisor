// =============================================================
// EAA 考试成绩工具测试 — exams / exam_grades / student_grades
// 覆盖: 空数据引导、考试对账、全班统计(均分/最高/缺考)、单生过滤、
//       成绩时间线排序与学期过滤、坏 exam_id 报错
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  // 注意: vi.hoisted 闭包先于 import 初始化,不能引用顶层 import 的 path — 用字符串拼接
  const tmpDir = `${process.env.TEMP || process.env.TMP || '/tmp'}/eaa-academic-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import {
  examGradesTool,
  examsTool,
  studentGradesTool,
} from '../../src/main/services/eaa/tools/academic-tools'

const baseDir = path.join(mocks.tmpDir, 'academics')
const gradesDir = path.join(baseDir, 'grades')

const EXAM_1 = {
  id: 'exam-mid-2026',
  name: '期中考试',
  type: 'midterm',
  date: '2026-04-20',
  semester: '2025-2026-2',
  scope: '全班',
  subjects: ['chinese', 'math'],
  createdAt: '2026-04-21T00:00:00.000Z',
}
const EXAM_2 = {
  ...EXAM_1,
  id: 'exam-final-2026',
  name: '期末考试',
  type: 'final',
  date: '2026-06-28',
  createdAt: '2026-06-29T00:00:00.000Z',
}

async function writeGrades(name: string, records: unknown[]) {
  await fsp.writeFile(path.join(gradesDir, `${name}.json`), JSON.stringify(records), 'utf-8')
}

/** 工具结果 → 解析后的 JSON(text 字段) */
// biome-ignore lint/suspicious/noExplicitAny: 测试辅助,工具结果为泛型
async function run(tool: any, params: unknown): Promise<any> {
  const result = await tool.execute('test-call', params, undefined)
  return JSON.parse(result.content[0].text)
}

describe('eaa_exams — 考试列表', () => {
  beforeAll(async () => {
    await fsp.mkdir(gradesDir, { recursive: true })
  })

  it('无考试时返回空列表 + 学业页录入引导', async () => {
    const data = await run(examsTool, {})
    expect(data.exams).toEqual([])
    expect(data.hint).toContain('学业')
  })

  it('返回考试视图,科目解析为名称+满分', async () => {
    await fsp.writeFile(path.join(baseDir, 'exams.json'), JSON.stringify([EXAM_1]), 'utf-8')
    const data = await run(examsTool, {})
    expect(data.exams).toHaveLength(1)
    const exam = data.exams[0]
    expect(exam.id).toBe('exam-mid-2026')
    expect(exam.subjects).toEqual([
      { id: 'chinese', name: '语文', fullMark: 150 },
      { id: 'math', name: '数学', fullMark: 150 },
    ])
  })

  it('semester 过滤', async () => {
    const data = await run(examsTool, { semester: '不存在' })
    expect(data.exams).toEqual([])
  })
})

describe('eaa_exam_grades — 考试成绩', () => {
  beforeAll(async () => {
    await fsp.writeFile(path.join(baseDir, 'exams.json'), JSON.stringify([EXAM_1]), 'utf-8')
    await writeGrades('张三', [
      { examId: EXAM_1.id, subjectId: 'chinese', studentName: '张三', score: 120, fullMark: 150 },
      { examId: EXAM_1.id, subjectId: 'math', studentName: '张三', score: 90, fullMark: 150 },
    ])
    await writeGrades('李四', [
      { examId: EXAM_1.id, subjectId: 'chinese', studentName: '李四', score: null, fullMark: 150 },
      { examId: EXAM_1.id, subjectId: 'math', studentName: '李四', score: 60, fullMark: 150 },
    ])
  })

  it('坏 exam_id → 明确报错并引导先查列表', async () => {
    await expect(run(examGradesTool, { exam_id: 'nope' })).rejects.toThrow(/eaa_exams/)
  })

  it('全班: 每科统计(均分/最高/最低/缺考) + 学生得分表', async () => {
    const data = await run(examGradesTool, { exam_id: EXAM_1.id })
    expect(data.exam.name).toBe('期中考试')
    const chinese = data.per_subject.chinese
    // 缺考(null)不计入均分: 只有张三 120
    expect(chinese).toMatchObject({ subject: '语文', avg: 120, max: 120, min: 120, absent: 1 })
    const math = data.per_subject.math
    expect(math).toMatchObject({ avg: 75, max: 90, min: 60, absent: 0 })
    const students = data.students as Array<{ name: string; scores: Record<string, number | null> }>
    expect(students).toHaveLength(2)
    expect(students.find((s) => s.name === '李四')?.scores).toEqual({ chinese: null, math: 60 })
  })

  it('subject_id 过滤只统计该科', async () => {
    const data = await run(examGradesTool, { exam_id: EXAM_1.id, subject_id: 'math' })
    expect(Object.keys(data.per_subject)).toEqual(['math'])
    expect(data.students[0].scores).not.toHaveProperty('chinese')
  })

  it('student 参数 → 只返回该生明细', async () => {
    const data = await run(examGradesTool, { exam_id: EXAM_1.id, student: '张三' })
    expect(data.grades).toHaveLength(2)
    expect(data.grades[0]).toMatchObject({ subject: '语文', score: 120, full_mark: 150 })
    expect(data.grades[1]).toMatchObject({ subject: '数学', score: 90 })
  })
})

describe('eaa_student_grades — 单生时间线', () => {
  beforeAll(async () => {
    await fsp.writeFile(
      path.join(baseDir, 'exams.json'),
      JSON.stringify([EXAM_1, EXAM_2]),
      'utf-8',
    )
    await writeGrades('王五', [
      { examId: EXAM_1.id, subjectId: 'math', studentName: '王五', score: 70, fullMark: 150 },
      { examId: EXAM_2.id, subjectId: 'math', studentName: '王五', score: 88, fullMark: 150 },
    ])
  })

  it('按考试日期倒序,附考试名与学期', async () => {
    const data = await run(studentGradesTool, { name: '王五' })
    expect(data.grades).toHaveLength(2)
    expect(data.grades[0].date).toBe('2026-06-28')
    expect(data.grades[0].exam).toContain('期末考试')
    expect(data.grades[1].date).toBe('2026-04-20')
  })

  it('semester 过滤', async () => {
    const data = await run(studentGradesTool, { name: '王五', semester: EXAM_1.semester })
    expect(data.grades).toHaveLength(2) // 两场考试同属一学期
    const none = await run(studentGradesTool, { name: '王五', semester: '1999-2000-1' })
    expect(none.grades).toEqual([])
    expect(none.hint).toBeTruthy()
  })

  it('无记录学生 → 空列表 + 引导', async () => {
    const data = await run(studentGradesTool, { name: '不存在的学生' })
    expect(data.grades).toEqual([])
    expect(data.hint).toContain('学业')
  })
})

// 文件级清理 — 单例 academicService 与各 describe 共享同一 tmp 目录,
// 清理必须等全部 describe 跑完(放在任一 describe 内会删掉后续 describe 的数据)
afterAll(async () => {
  try {
    await fsp.rm(mocks.tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})
