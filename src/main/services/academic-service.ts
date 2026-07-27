// =============================================================
// Academic Service — 学业数据存储 (科目/考试/成绩)
// 存储于 eaa-data/academics/
//   - config.json         科目定义 + 考试类型
//   - exams.json          考试定义 (ExamDef[])
//   - grades/{name}.json  按学生分文件的成绩记录
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AcademicConfig, ExamDef, GradeRecord, SubjectDef } from '../../shared/types'
import { atomicWrite } from '../utils/atomic-write'
import { log } from '../utils/logger'

const DEFAULT_SUBJECTS: SubjectDef[] = [
  { id: 'chinese', name: '语文', category: 'core', fullMark: 150, isCore: true },
  { id: 'math', name: '数学', category: 'core', fullMark: 150, isCore: true },
  { id: 'english', name: '英语', category: 'core', fullMark: 150, isCore: true },
  { id: 'physics', name: '物理', category: 'science', fullMark: 100 },
  { id: 'chemistry', name: '化学', category: 'science', fullMark: 100 },
  { id: 'biology', name: '生物', category: 'science', fullMark: 100 },
  { id: 'politics', name: '政治', category: 'arts', fullMark: 100 },
  { id: 'history', name: '历史', category: 'arts', fullMark: 100 },
  { id: 'geography', name: '地理', category: 'arts', fullMark: 100 },
  { id: 'pe', name: '体育', category: 'pe', fullMark: 100 },
]

const DEFAULT_CONFIG: AcademicConfig = {
  subjects: DEFAULT_SUBJECTS,
  defaultExamTypes: [
    { value: 'monthly', label: '月考' },
    { value: 'midterm', label: '期中考试' },
    { value: 'final', label: '期末考试' },
    { value: 'quiz', label: '小测' },
    { value: 'test', label: '单元测试' },
    { value: 'mock', label: '模拟考试' },
    { value: 'other', label: '其他' },
  ],
}

class AcademicService {
  private baseDir: string
  private configPath: string
  private examsPath: string
  private gradesDir: string
  /**
   * 按学生串行化的写操作队列(防止并发 setGrade lost update)。
   * 同一学生的读-改-写串行执行;不同学生不互斥(各自独立队列)。
   */
  private gradeWriteQueues: Map<string, Promise<unknown>> = new Map()

  constructor() {
    this.baseDir = path.join(app.getPath('userData'), 'eaa-data', 'academics')
    this.configPath = path.join(this.baseDir, 'config.json')
    this.examsPath = path.join(this.baseDir, 'exams.json')
    this.gradesDir = path.join(this.baseDir, 'grades')
    // 不在构造函数中创建目录,延迟到首次写入
  }

  /** 防止路径遍历攻击 + 非法字符 */
  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
  }

  /** 延迟创建目录(仅在写入前调用) */
  private async ensureDir(): Promise<void> {
    try {
      await fsp.mkdir(this.baseDir, { recursive: true })
      await fsp.mkdir(this.gradesDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private gradePath(studentName: string): string {
    return path.join(this.gradesDir, `${this.safeName(studentName)}.json`)
  }

  // ===== Config =====

  /** 读取学业配置(文件不存在时返回默认配置) */
  async getConfig(): Promise<AcademicConfig> {
    try {
      const content = await fsp.readFile(this.configPath, 'utf-8')
      return JSON.parse(content) as AcademicConfig
    } catch {
      return DEFAULT_CONFIG
    }
  }

  /** 写入学业配置 */
  async setConfig(config: AcademicConfig): Promise<void> {
    await this.ensureDir()
    const json = JSON.stringify(config, null, 2)
    await atomicWrite(this.configPath, json)
    log('info', 'academic', `config updated (${config.subjects?.length ?? 0} subjects)`)
  }

  // ===== Exams =====

  /** 列出考试(可选按学期过滤) */
  async listExams(semester?: string): Promise<ExamDef[]> {
    try {
      const content = await fsp.readFile(this.examsPath, 'utf-8')
      const exams = JSON.parse(content) as ExamDef[]
      if (semester) {
        return exams.filter((e) => e.semester === semester)
      }
      return exams
    } catch {
      return []
    }
  }

  /** 新建考试 */
  async createExam(exam: Omit<ExamDef, 'id' | 'createdAt'>): Promise<ExamDef> {
    await this.ensureDir()
    const exams = await this.listExams()
    const id = `exam-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const createdAt = new Date().toISOString()
    const record: ExamDef = {
      id,
      name: exam.name,
      type: exam.type,
      date: exam.date,
      semester: exam.semester,
      scope: exam.scope,
      subjects: Array.isArray(exam.subjects) ? exam.subjects : [],
      createdAt,
    }
    exams.push(record)
    await atomicWrite(this.examsPath, JSON.stringify(exams, null, 2))
    log('info', 'academic', `exam created: ${id} (${record.name})`)
    return record
  }

  /** 删除考试 — 同时级联删除该考试的所有成绩记录 */
  async deleteExam(examId: string): Promise<void> {
    await this.ensureDir()
    // 1. 从 exams.json 移除考试
    const exams = await this.listExams()
    const next = exams.filter((e) => e.id !== examId)
    await atomicWrite(this.examsPath, JSON.stringify(next, null, 2))

    // 2. 级联删除所有学生文件中该考试的成绩
    let removedGrades = 0
    try {
      const files = await fsp.readdir(this.gradesDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = path.join(this.gradesDir, file)
        try {
          const content = await fsp.readFile(filePath, 'utf-8')
          const grades = JSON.parse(content) as GradeRecord[]
          const filtered = grades.filter((g) => g.examId !== examId)
          if (filtered.length !== grades.length) {
            removedGrades += grades.length - filtered.length
            if (filtered.length === 0) {
              // 文件变空,删除文件
              await fsp.unlink(filePath)
            } else {
              await atomicWrite(filePath, JSON.stringify(filtered, null, 2))
            }
          }
        } catch {
          // 跳过无法解析的文件
        }
      }
    } catch {
      // grades 目录不存在或读取失败,忽略
    }

    log('info', 'academic', `exam deleted: ${examId} (cascade removed ${removedGrades} grades)`)
  }

  // ===== Grades =====

  /** 读取学生全部成绩记录 */
  async getGrades(studentName: string): Promise<GradeRecord[]> {
    try {
      const content = await fsp.readFile(this.gradePath(studentName), 'utf-8')
      return JSON.parse(content) as GradeRecord[]
    } catch {
      return []
    }
  }

  /** 写入学生全部成绩记录(内部) */
  private async writeGrades(studentName: string, grades: GradeRecord[]): Promise<void> {
    await this.ensureDir()
    await atomicWrite(this.gradePath(studentName), JSON.stringify(grades, null, 2))
  }

  /**
   * 按学生串行化执行"读-改-写"操作,防止并发 setGrade/batchSetGrades 的 lost update。
   * 不同学生不互斥(各自独立队列),同一学生串行(避免读-改-写竞态)。
   */
  private async withGradeLock<T>(studentName: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.gradeWriteQueues.get(studentName) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    this.gradeWriteQueues.set(
      studentName,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  /** 设置单条成绩(upsert by examId + subjectId) */
  async setGrade(record: Omit<GradeRecord, 'updatedAt'>): Promise<GradeRecord> {
    if (!record.examId || typeof record.examId !== 'string') {
      throw new Error('setGrade: examId 必须是非空字符串')
    }
    if (!record.subjectId || typeof record.subjectId !== 'string') {
      throw new Error('setGrade: subjectId 必须是非空字符串')
    }
    if (!record.studentName || typeof record.studentName !== 'string') {
      throw new Error('setGrade: studentName 必须是非空字符串')
    }
    if (
      record.score !== null &&
      (typeof record.score !== 'number' || !Number.isFinite(record.score))
    ) {
      throw new Error(`setGrade: score 必须是有限数字或 null,收到 ${typeof record.score}`)
    }
    if (record.score !== null && record.fullMark > 0) {
      if (record.score < 0 || record.score > record.fullMark) {
        throw new Error(`setGrade: score ${record.score} 超出范围 [0, ${record.fullMark}]`)
      }
    }
    const exams = await this.listExams()
    const exam = exams.find((e) => e.id === record.examId)
    if (!exam) {
      throw new Error(`setGrade: 考试不存在: ${record.examId}`)
    }
    if (exam.subjects.length > 0 && !exam.subjects.includes(record.subjectId)) {
      throw new Error(
        `setGrade: 科目 ${record.subjectId} 不属于考试 ${record.examId}(${exam.name})`,
      )
    }
    return this.withGradeLock(record.studentName, async () => {
      const existing = await this.getGrades(record.studentName)
      const idx = existing.findIndex(
        (g) => g.examId === record.examId && g.subjectId === record.subjectId,
      )
      const full: GradeRecord = { ...record, updatedAt: new Date().toISOString() }
      if (idx >= 0) {
        existing[idx] = full
      } else {
        existing.push(full)
      }
      await this.writeGrades(record.studentName, existing)
      return full
    })
  }

  /** 批量设置成绩(按学生分组,每个学生文件只读写一次) */
  async batchSetGrades(records: Omit<GradeRecord, 'updatedAt'>[]): Promise<number> {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('batchSetGrades: records 必须是非空数组')
    }
    const exams = await this.listExams()
    const examMap = new Map(exams.map((e) => [e.id, e]))
    for (const [i, r] of records.entries()) {
      if (!r.examId || typeof r.examId !== 'string') {
        throw new Error(`batchSetGrades: records[${i}].examId 必须是非空字符串`)
      }
      if (!r.studentName || typeof r.studentName !== 'string') {
        throw new Error(`batchSetGrades: records[${i}].studentName 必须是非空字符串`)
      }
      if (r.score !== null && (typeof r.score !== 'number' || !Number.isFinite(r.score))) {
        throw new Error(`batchSetGrades: records[${i}].score 必须是有限数字或 null`)
      }
      if (r.score !== null && r.fullMark > 0 && (r.score < 0 || r.score > r.fullMark)) {
        throw new Error(
          `batchSetGrades: records[${i}].score ${r.score} 超出范围 [0, ${r.fullMark}]`,
        )
      }
      const exam = examMap.get(r.examId)
      if (!exam) {
        throw new Error(`batchSetGrades: records[${i}] 考试不存在: ${r.examId}`)
      }
      if (exam.subjects.length > 0 && !exam.subjects.includes(r.subjectId)) {
        throw new Error(`batchSetGrades: records[${i}] 科目 ${r.subjectId} 不属于考试 ${r.examId}`)
      }
    }

    const byStudent = new Map<string, Omit<GradeRecord, 'updatedAt'>[]>()
    for (const r of records) {
      const arr = byStudent.get(r.studentName)
      if (arr) {
        arr.push(r)
      } else {
        byStudent.set(r.studentName, [r])
      }
    }

    let count = 0
    const now = new Date().toISOString()
    const counts = await Promise.all(
      Array.from(byStudent.entries()).map(([studentName, recs]) =>
        this.withGradeLock(studentName, async () => {
          const existing = await this.getGrades(studentName)
          let n = 0
          for (const r of recs) {
            const idx = existing.findIndex(
              (g) => g.examId === r.examId && g.subjectId === r.subjectId,
            )
            const full: GradeRecord = { ...r, updatedAt: now }
            if (idx >= 0) {
              existing[idx] = full
            } else {
              existing.push(full)
            }
            n++
          }
          await this.writeGrades(studentName, existing)
          return n
        }),
      ),
    )
    count = counts.reduce((a, b) => a + b, 0)
    log('info', 'academic', `batch set grades: ${count} records across ${byStudent.size} students`)
    return count
  }

  /**
   * 读取一个班级(学生列表)在某场考试的成绩。
   * studentNames 由调用方(EAA CLI)解析 classId → 学生列表后传入。
   * 返回 Record<studentName, GradeRecord[]>。
   */
  async getClassGrades(
    studentNames: string[],
    examId: string,
    subjectId?: string,
  ): Promise<Record<string, GradeRecord[]>> {
    const result: Record<string, GradeRecord[]> = {}
    for (const name of studentNames) {
      let grades = await this.getGrades(name)
      grades = grades.filter((g) => g.examId === examId)
      if (subjectId) {
        grades = grades.filter((g) => g.subjectId === subjectId)
      }
      result[name] = grades
    }
    return result
  }
}

export const academicService = new AcademicService()
