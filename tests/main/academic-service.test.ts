// =============================================================
// Academic Service 测试
// 覆盖: getConfig/listExams/createExam/deleteExam(级联)/getGrades/
//       batchSetGrades(校验+读改写)/getClassGrades/safeName
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}academic-svc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { academicService } from '../../src/main/services/academic-service'

const baseDir = path.join(mocks.userDataDir, 'eaa-data', 'academics')
const gradesDir = path.join(baseDir, 'grades')

describe('academicService — config/exams 基础读写', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
  })
  afterAll(async () => {
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('getConfig: 文件不存在时返回默认配置', async () => {
    const cfg = await academicService.getConfig()
    expect(cfg.subjects.length).toBe(10)
    expect(cfg.subjects[0]).toMatchObject({ id: 'chinese', fullMark: 150, isCore: true })
    expect(cfg.defaultExamTypes.map((t) => t.value)).toContain('midterm')
  })

  it('getConfig: 读取已持久化的自定义配置', async () => {
    await fsp.mkdir(baseDir, { recursive: true })
    const custom = {
      subjects: [{ id: 'art', name: '美术', category: 'arts', fullMark: 50 }],
      defaultExamTypes: [{ value: 'x', label: 'X' }],
    }
    await fsp.writeFile(path.join(baseDir, 'config.json'), JSON.stringify(custom), 'utf-8')
    const cfg = await academicService.getConfig()
    expect(cfg.subjects.length).toBe(1)
    expect(cfg.subjects[0].id).toBe('art')
  })

  it('listExams: 无文件时返回空数组', async () => {
    const exams = await academicService.listExams()
    expect(exams).toEqual([])
  })

  it('createExam: 生成 id/createdAt,subjects 缺省为空数组并持久化', async () => {
    const r = await academicService.createExam({
      name: '期中考试',
      type: 'midterm',
      date: '2026-03-10',
      semester: '2025-2026-2',
      scope: '全年级',
    })
    expect(r.id).toMatch(/^exam-/)
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.subjects).toEqual([])
    expect(r.name).toBe('期中考试')

    const persisted = await academicService.listExams()
    expect(persisted.find((e) => e.id === r.id)).toBeDefined()
  })

  it('listExams: 按 semester 过滤', async () => {
    await academicService.createExam({
      name: '期末考试',
      type: 'final',
      date: '2026-06-20',
      semester: '2025-2026-2',
    })
    await academicService.createExam({
      name: '九月月考',
      type: 'monthly',
      date: '2026-09-05',
      semester: '2026-2027-1',
    })
    const s2 = await academicService.listExams('2025-2026-2')
    expect(s2.length).toBeGreaterThanOrEqual(2)
    expect(s2.every((e) => e.semester === '2025-2026-2')).toBe(true)
    const s1 = await academicService.listExams('2026-2027-1')
    expect(s1.every((e) => e.semester === '2026-2027-1')).toBe(true)
  })
})

describe('academicService — batchSetGrades 校验', () => {
  it('空数组应报错', async () => {
    await expect(academicService.batchSetGrades([])).rejects.toThrow('非空数组')
  })

  it('examId 缺失/非字符串应报错', async () => {
    await expect(
      academicService.batchSetGrades([
        { studentName: '小明', subjectId: 'math', score: 100 } as never,
      ]),
    ).rejects.toThrow('examId')
    await expect(
      academicService.batchSetGrades([
        { examId: '', studentName: '小明', subjectId: 'math', score: 100 },
      ]),
    ).rejects.toThrow('examId')
  })

  it('studentName 缺失应报错', async () => {
    await expect(
      academicService.batchSetGrades([
        { examId: 'exam-x', subjectId: 'math', score: 100 } as never,
      ]),
    ).rejects.toThrow('studentName')
  })

  it('score 非有限数字应报错', async () => {
    await expect(
      academicService.batchSetGrades([
        { examId: 'exam-x', studentName: '小明', subjectId: 'math', score: 'high' as never },
      ]),
    ).rejects.toThrow('score')
    await expect(
      academicService.batchSetGrades([
        { examId: 'exam-x', studentName: '小明', subjectId: 'math', score: Number.NaN },
      ]),
    ).rejects.toThrow('score')
  })

  it('考试不存在应报错', async () => {
    await expect(
      academicService.batchSetGrades([
        { examId: 'exam-not-exist', studentName: '小明', subjectId: 'math', score: 100 },
      ]),
    ).rejects.toThrow('考试不存在')
  })

  it('科目不属于考试应报错(exam.subjects 非空时)', async () => {
    const exam = await academicService.createExam({
      name: '数学专项',
      type: 'test',
      date: '2026-04-01',
      semester: '2025-2026-2',
      subjects: ['math'],
    })
    await expect(
      academicService.batchSetGrades([
        { examId: exam.id, studentName: '小明', subjectId: 'pe', score: 100 },
      ]),
    ).rejects.toThrow('不属于考试')
  })

  it('score 超出科目满分应报错(math 满分 150)', async () => {
    const exam = await academicService.createExam({
      name: '满分校验考试',
      type: 'test',
      date: '2026-04-02',
      semester: '2025-2026-2',
      subjects: [],
    })
    await expect(
      academicService.batchSetGrades([
        { examId: exam.id, studentName: '小明', subjectId: 'math', score: 9999 },
      ]),
    ).rejects.toThrow('超出范围')
    await expect(
      academicService.batchSetGrades([
        { examId: exam.id, studentName: '小明', subjectId: 'math', score: -1 },
      ]),
    ).rejects.toThrow('超出范围')
  })
})

describe('academicService — 成绩读写与级联删除', () => {
  it('getGrades: 无记录返回空数组', async () => {
    expect(await academicService.getGrades('不存在的学生')).toEqual([])
  })

  it('batchSetGrades: 新增/覆盖成绩并返回写入数量', async () => {
    const exam = await academicService.createExam({
      name: '成绩主流程考试',
      type: 'monthly',
      date: '2026-05-01',
      semester: '2025-2026-2',
      subjects: ['math', 'chinese'],
    })
    // 新增两条
    const n1 = await academicService.batchSetGrades([
      { examId: exam.id, studentName: '小明', subjectId: 'math', score: 148 },
      { examId: exam.id, studentName: '小明', subjectId: 'chinese', score: 130 },
    ])
    expect(n1).toBe(2)
    let grades = await academicService.getGrades('小明')
    expect(grades.length).toBe(2)
    expect(grades.find((g) => g.subjectId === 'math')?.score).toBe(148)
    expect(grades.every((g) => typeof g.updatedAt === 'string')).toBe(true)

    // 同 examId+subjectId 覆盖而非追加
    const n2 = await academicService.batchSetGrades([
      { examId: exam.id, studentName: '小明', subjectId: 'math', score: 150 },
    ])
    expect(n2).toBe(1)
    grades = await academicService.getGrades('小明')
    expect(grades.length).toBe(2)
    expect(grades.find((g) => g.subjectId === 'math')?.score).toBe(150)
  })

  it('batchSetGrades: score=null 与自定义 fullMark 通过校验', async () => {
    const exam = await academicService.createExam({
      name: '边界考试',
      type: 'other',
      date: '2026-05-02',
      semester: '2025-2026-2',
      subjects: [],
    })
    // score null(缺考)合法
    const n = await academicService.batchSetGrades([
      { examId: exam.id, studentName: '小红', subjectId: 'art', score: null, fullMark: 50 },
      // 自带 fullMark=250 时 200 分合法(覆盖科目默认满分)
      { examId: exam.id, studentName: '小红', subjectId: 'math', score: 200, fullMark: 250 },
      // 未知科目 fullMark 推导为 0 → 跳过范围校验
      { examId: exam.id, studentName: '小红', subjectId: 'custom-subject', score: 9999 },
    ])
    expect(n).toBe(3)
    const grades = await academicService.getGrades('小红')
    expect(grades.find((g) => g.subjectId === 'art')?.score).toBeNull()
    expect(grades.find((g) => g.subjectId === 'custom-subject')?.score).toBe(9999)
  })

  it('batchSetGrades: 多学生分组写入各自文件', async () => {
    const exam = await academicService.createExam({
      name: '多人考试',
      type: 'quiz',
      date: '2026-05-03',
      semester: '2025-2026-2',
      subjects: [],
    })
    const n = await academicService.batchSetGrades([
      { examId: exam.id, studentName: '学生甲', subjectId: 'math', score: 90 },
      { examId: exam.id, studentName: '学生乙', subjectId: 'math', score: 95 },
    ])
    expect(n).toBe(2)
    expect((await academicService.getGrades('学生甲')).length).toBe(1)
    expect((await academicService.getGrades('学生乙')).length).toBe(1)
  })

  it('safeName: 非法字符学生名映射到同一清洗后文件', async () => {
    const exam = await academicService.createExam({
      name: '清洗考试',
      type: 'other',
      date: '2026-05-04',
      semester: '2025-2026-2',
      subjects: [],
    })
    await academicService.batchSetGrades([
      { examId: exam.id, studentName: '张/三', subjectId: 'math', score: 60 },
    ])
    // '/' 与 '\' 都被 safeName 替换为 '_',二者读同一文件
    const viaBackslash = await academicService.getGrades('张\\三')
    expect(viaBackslash.length).toBe(1)
    expect(viaBackslash[0].studentName).toBe('张/三')
    // grades 目录下文件名不含原始非法字符
    const files = await fsp.readdir(gradesDir)
    expect(files.some((f) => f === '张_三.json')).toBe(true)
  })

  it('deleteExam: 级联删除成绩,空文件删除,非空文件保留', async () => {
    const examA = await academicService.createExam({
      name: '级联考试A',
      type: 'other',
      date: '2026-05-05',
      semester: '2025-2026-2',
      subjects: [],
    })
    const examB = await academicService.createExam({
      name: '级联考试B',
      type: 'other',
      date: '2026-05-06',
      semester: '2025-2026-2',
      subjects: [],
    })
    await academicService.batchSetGrades([
      { examId: examA.id, studentName: '纯A学生', subjectId: 'math', score: 80 },
      { examId: examA.id, studentName: 'AB学生', subjectId: 'math', score: 81 },
      { examId: examB.id, studentName: 'AB学生', subjectId: 'math', score: 82 },
    ])

    await academicService.deleteExam(examA.id)

    // 考试已删除
    const exams = await academicService.listExams()
    expect(exams.find((e) => e.id === examA.id)).toBeUndefined()
    expect(exams.find((e) => e.id === examB.id)).toBeDefined()

    // 纯A学生文件变空 → 文件被删除
    expect(await academicService.getGrades('纯A学生')).toEqual([])
    const files = await fsp.readdir(gradesDir)
    expect(files.some((f) => f === '纯A学生.json')).toBe(false)

    // AB学生文件保留但只剩 examB 的成绩
    const ab = await academicService.getGrades('AB学生')
    expect(ab.length).toBe(1)
    expect(ab[0].examId).toBe(examB.id)
  })

  it('getClassGrades: 按 examId/subjectId 过滤', async () => {
    const exam = await academicService.createExam({
      name: '班级成绩考试',
      type: 'other',
      date: '2026-05-07',
      semester: '2025-2026-2',
      subjects: [],
    })
    await academicService.batchSetGrades([
      { examId: exam.id, studentName: '班学生1', subjectId: 'math', score: 70 },
      { examId: exam.id, studentName: '班学生1', subjectId: 'chinese', score: 71 },
      { examId: exam.id, studentName: '班学生2', subjectId: 'math', score: 72 },
    ])
    const byExam = await academicService.getClassGrades(['班学生1', '班学生2'], exam.id)
    expect(Object.keys(byExam).sort()).toEqual(['班学生1', '班学生2'])
    expect(byExam['班学生1'].length).toBe(2)

    const bySubject = await academicService.getClassGrades(['班学生1', '班学生2'], exam.id, 'math')
    expect(bySubject['班学生1'].length).toBe(1)
    expect(bySubject['班学生1'][0].subjectId).toBe('math')
    expect(bySubject['班学生2'].length).toBe(1)
  })
})