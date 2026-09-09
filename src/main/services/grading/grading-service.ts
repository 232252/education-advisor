// =============================================================
// Grading Service — AI 批改任务存储
// 存储于 <appData>/grading/
//   - tasks/<taskId>.json        任务(量规+试卷记录+AI结果+复核)
//   - files/<taskId>/<stored>    试卷扫描件(图片,每任务独立目录)
// 并发: 按任务串行化写队列(防 lost update,口径同 academic-service);
//       状态机与量规编辑窗口在此校验,IPC 层只做入参类型检查。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  AiGradeResult,
  GradingPaper,
  GradingTask,
  GradingTaskStatus,
  PaperFile,
  RubricQuestion,
  TeacherReview,
} from '@shared/types'
import { atomicWrite } from '../../utils/atomic-write'
import { log } from '../../utils/logger'
import { academicService } from '../academic-service'
import { getAppPaths } from '../paths'
import { buildPublishPayload, type PublishPayload } from './publish'

/** 允许的图片扩展名(试卷扫描件;PDF 转图由渲染层完成后同样落此白名单) */
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
/** 单文件上限 25MB(扫描件留足余量) */
const MAX_FILE_BYTES = 25 * 1024 * 1024
/** 单任务试卷份数上限 */
const MAX_PAPERS_PER_TASK = 300

/** 状态机合法迁移 */
const ALLOWED_TRANSITIONS: Record<GradingTaskStatus, GradingTaskStatus[]> = {
  draft: ['ready'],
  ready: ['grading', 'draft'],
  grading: ['review', 'ready'], // ready = 批改中止/全部失败回退
  review: ['published', 'grading'],
  published: ['review'], // 发布后发现错误 → 回复核改分后重新发布
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 任务 id 白名单(防路径拼接攻击) */
function assertTaskId(id: string): void {
  if (!/^grading-[a-z0-9-]+$/i.test(id)) {
    throw new Error(`非法任务 id: ${id}`)
  }
}

function assertPaperId(id: string): void {
  if (!/^paper-[a-z0-9-]+$/i.test(id)) {
    throw new Error(`非法试卷 id: ${id}`)
  }
}

/** 存储文件名净化(保留中文,去路径分隔符等危险字符) */
function safeStoredName(name: string): string {
  return name.replace(/[/\\:*?"<>|\s]+/g, '_').slice(-120)
}

/** MIME 由扩展名推导(白名单已保证) */
function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'image/jpeg'
  }
}

function validateRubric(rubric: RubricQuestion[]): void {
  if (!Array.isArray(rubric)) throw new Error('量规必须是数组')
  const seen = new Set<string>()
  for (const [i, q] of rubric.entries()) {
    if (!q || typeof q !== 'object') throw new Error(`量规[${i}] 必须是对象`)
    if (typeof q.id !== 'string' || q.id.length === 0) throw new Error(`量规[${i}].id 必须非空`)
    if (seen.has(q.id)) throw new Error(`量规 id 重复: ${q.id}`)
    seen.add(q.id)
    if (typeof q.title !== 'string' || q.title.trim().length === 0) {
      throw new Error(`量规[${i}].title 必须非空`)
    }
    if (!Number.isFinite(q.fullMark) || q.fullMark <= 0) {
      throw new Error(`量规[${i}].fullMark 必须为正数`)
    }
    if (typeof q.order !== 'number') throw new Error(`量规[${i}].order 必须为数字`)
    if (q.presetMarks !== undefined) {
      if (!Array.isArray(q.presetMarks)) throw new Error(`量规[${i}].presetMarks 必须是数组`)
      for (const [j, m] of q.presetMarks.entries()) {
        if (!m || typeof m !== 'object') throw new Error(`量规[${i}].presetMarks[${j}] 必须是对象`)
        if (typeof m.note !== 'string' || m.note.trim().length === 0) {
          throw new Error(`量规[${i}].presetMarks[${j}].note 必须非空`)
        }
        if (!Number.isFinite(m.points)) {
          throw new Error(`量规[${i}].presetMarks[${j}].points 必须是数字`)
        }
      }
    }
  }
}

class GradingService {
  private baseDir: string
  private tasksDir: string
  private filesDir: string
  /** 按任务串行化的写队列 */
  private writeQueues: Map<string, Promise<unknown>> = new Map()

  constructor() {
    const paths = getAppPaths()
    this.baseDir = paths.gradingDir
    this.tasksDir = path.join(this.baseDir, 'tasks')
    this.filesDir = path.join(this.baseDir, 'files')
    // 不在构造函数中创建目录,延迟到首次写入(口径同 academic-service)
  }

  private taskPath(id: string): string {
    return path.join(this.tasksDir, `${id}.json`)
  }

  private taskFilesDir(id: string): string {
    return path.join(this.filesDir, id)
  }

  private async ensureDirs(): Promise<void> {
    await fsp.mkdir(this.tasksDir, { recursive: true })
  }

  private async withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(taskId) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    this.writeQueues.set(
      taskId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  // ===== 读 =====

  /** 任务列表(按更新时间倒序) */
  async listTasks(): Promise<GradingTask[]> {
    let files: string[]
    try {
      files = await fsp.readdir(this.tasksDir)
    } catch {
      return []
    }
    const tasks: GradingTask[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = await fsp.readFile(path.join(this.tasksDir, file), 'utf-8')
        tasks.push(JSON.parse(content) as GradingTask)
      } catch {
        // 跳过无法解析的文件(容错口径同 academic-service)
      }
    }
    return tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async getTask(id: string): Promise<GradingTask> {
    assertTaskId(id)
    try {
      const content = await fsp.readFile(this.taskPath(id), 'utf-8')
      return JSON.parse(content) as GradingTask
    } catch {
      throw new Error(`批改任务不存在: ${id}`)
    }
  }

  // ===== 任务 =====

  async createTask(input: {
    name: string
    semester: string
    classId?: string
    className?: string
    subjectId?: string
    examDate?: string
    rubric?: RubricQuestion[]
  }): Promise<GradingTask> {
    if (!input?.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new Error('任务名不能为空')
    }
    if (!input?.semester || typeof input.semester !== 'string') {
      throw new Error('学期不能为空')
    }
    const rubric = input.rubric ?? []
    validateRubric(rubric)
    await this.ensureDirs()
    const now = new Date().toISOString()
    const task: GradingTask = {
      id: newId('grading'),
      name: input.name.trim(),
      semester: input.semester,
      classId: input.classId,
      className: input.className,
      subjectId: input.subjectId,
      examDate: input.examDate,
      status: 'draft',
      rubric,
      papers: [],
      createdAt: now,
      updatedAt: now,
    }
    await atomicWrite(this.taskPath(task.id), JSON.stringify(task, null, 2))
    log('info', 'grading', `task created: ${task.id} (${task.name})`)
    return task
  }

  /**
   * 更新任务元数据/量规。量规在 AI 批改开始(grading)后锁定 ——
   * 已产出的逐题结果必须始终对应一套稳定量规。
   */
  async updateTask(
    id: string,
    patch: Partial<
      Pick<
        GradingTask,
        'name' | 'semester' | 'classId' | 'className' | 'subjectId' | 'examDate' | 'rubric'
      >
    >,
  ): Promise<GradingTask> {
    assertTaskId(id)
    return this.withTaskLock(id, async () => {
      const task = await this.getTask(id)
      if (task.status === 'grading') {
        throw new Error('AI 批改进行中,任务不可编辑')
      }
      if (patch.rubric !== undefined) {
        if (task.status === 'published' || task.status === 'review') {
          throw new Error('已有批改结果,量规锁定(如需修改请新建任务)')
        }
        validateRubric(patch.rubric)
      }
      if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || patch.name.trim().length === 0) {
          throw new Error('任务名不能为空')
        }
        task.name = patch.name.trim()
      }
      if (patch.semester !== undefined) {
        if (typeof patch.semester !== 'string' || patch.semester.trim().length === 0) {
          throw new Error('学期不能为空')
        }
        task.semester = patch.semester
      }
      for (const key of ['classId', 'className', 'subjectId', 'examDate'] as const) {
        const value = patch[key]
        if (value === undefined || typeof value === 'string') {
          task[key] = value
        }
      }
      if (patch.rubric !== undefined) task.rubric = patch.rubric
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(id), JSON.stringify(task, null, 2))
      return task
    })
  }

  async deleteTask(id: string): Promise<void> {
    assertTaskId(id)
    await fsp.rm(this.taskPath(id), { force: true })
    await fsp.rm(this.taskFilesDir(id), { recursive: true, force: true })
    log('info', 'grading', `task deleted: ${id}`)
  }

  async setStatus(id: string, status: GradingTaskStatus): Promise<GradingTask> {
    assertTaskId(id)
    return this.withTaskLock(id, async () => {
      const task = await this.getTask(id)
      if (task.status === status) return task
      if (!ALLOWED_TRANSITIONS[task.status].includes(status)) {
        throw new Error(`非法状态迁移: ${task.status} → ${status}`)
      }
      task.status = status
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(id), JSON.stringify(task, null, 2))
      return task
    })
  }

  // ===== 试卷 =====

  /**
   * 导入试卷扫描件: 拷贝进 files/<taskId>/,每批文件合并为一份试卷
   * (一次上传通常是一个学生的全部页)。归组建议由渲染层用
   * matchPaperFilesToStudents 生成,人工确认后经 assignPaper 落库。
   */
  async importPapers(
    taskId: string,
    batches: Array<{ files: Array<{ path: string; name?: string }> }>,
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    if (!Array.isArray(batches) || batches.length === 0) {
      throw new Error('导入批次不能为空')
    }
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      if (task.status !== 'draft' && task.status !== 'ready') {
        throw new Error(`当前状态(${task.status})不可导入试卷`)
      }
      if (task.papers.length + batches.length > MAX_PAPERS_PER_TASK) {
        throw new Error(`超出单任务试卷上限 ${MAX_PAPERS_PER_TASK}`)
      }
      const destDir = this.taskFilesDir(taskId)
      await fsp.mkdir(destDir, { recursive: true })
      const now = new Date().toISOString()
      for (const batch of batches) {
        if (!Array.isArray(batch?.files) || batch.files.length === 0) {
          throw new Error('每批必须包含至少一个文件')
        }
        const paper: GradingPaper = {
          id: newId('paper'),
          studentName: null,
          files: [],
          uploadedAt: now,
          status: 'unassigned',
        }
        for (const f of batch.files) {
          if (typeof f?.path !== 'string' || f.path.length === 0) {
            throw new Error('文件路径不能为空')
          }
          const ext = path.extname(f.path).toLowerCase()
          if (!ALLOWED_IMAGE_EXTS.has(ext)) {
            throw new Error(`不支持的文件类型 ${ext}(支持 jpg/png/webp/bmp)`)
          }
          const stat = await fsp.stat(f.path)
          if (!stat.isFile()) throw new Error(`不是文件: ${f.path}`)
          if (stat.size > MAX_FILE_BYTES) {
            throw new Error(
              `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限: ${path.basename(f.path)}`,
            )
          }
          const original = f.name?.trim() || path.basename(f.path)
          const storedName = `${paper.id}-${safeStoredName(original)}`
          await fsp.copyFile(f.path, path.join(destDir, storedName))
          const record: PaperFile = {
            name: original,
            storedName,
            mime: mimeFromExt(ext),
            bytes: stat.size,
          }
          paper.files.push(record)
        }
        if (paper.files.length === 0) throw new Error('每批至少一个文件')
        task.papers.push(paper)
      }
      task.updatedAt = now
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      log('info', 'grading', `papers imported: ${batches.length} batches → ${task.id}`)
      return task
    })
  }

  /** 归组: 指认/改派/取消试卷归属 */
  async assignPaper(
    taskId: string,
    paperId: string,
    studentName: string | null,
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      paper.studentName = studentName && studentName.trim().length > 0 ? studentName.trim() : null
      if (paper.studentName === null) {
        paper.status = 'unassigned'
      } else if (paper.status === 'unassigned') {
        paper.status = 'pending'
      }
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  async removePaper(taskId: string, paperId: string): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const idx = task.papers.findIndex((p) => p.id === paperId)
      if (idx < 0) throw new Error(`试卷不存在: ${paperId}`)
      const [removed] = task.papers.splice(idx, 1)
      for (const f of removed.files) {
        await fsp.rm(path.join(this.taskFilesDir(taskId), f.storedName), { force: true })
      }
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  // ===== 批改结果 =====

  /** AI 结果落库(P3 管线逐份调用);分数越界在入口即拒 */
  async saveAiResult(taskId: string, paperId: string, result: AiGradeResult): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      if (paper.status !== 'pending' && paper.status !== 'failed') {
        throw new Error(`试卷状态 ${paper.status} 不可写入 AI 结果`)
      }
      const fullMarkById = new Map(task.rubric.map((q) => [q.id, q.fullMark]))
      for (const q of result.questions) {
        const full = fullMarkById.get(q.questionId)
        if (full === undefined) {
          throw new Error(`AI 结果含未知题目: ${q.questionId}`)
        }
        if (!Number.isFinite(q.score) || q.score < 0 || q.score > full) {
          throw new Error(`AI 分数越界 [0, ${full}]: ${q.questionId} = ${q.score}`)
        }
      }
      paper.ai = result
      paper.error = undefined
      paper.status = 'graded'
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /** 批改失败记录(P3 管线 catch 路径) */
  async savePaperError(taskId: string, paperId: string, error: string): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      paper.status = 'failed'
      paper.error = error
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /** 教师复核落库(分数越界拒收,口径同 AI 结果) */
  async saveReview(taskId: string, paperId: string, review: TeacherReview): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      if (!paper.ai) throw new Error('该试卷尚无 AI 结果,无需复核')
      if (task.status !== 'review' && task.status !== 'published') {
        throw new Error(`任务状态 ${task.status} 不可保存复核`)
      }
      const fullMarkById = new Map(task.rubric.map((q) => [q.id, q.fullMark]))
      for (const [questionId, override] of Object.entries(review.questions ?? {})) {
        const qdef = task.rubric.find((q) => q.id === questionId)
        const full = qdef ? fullMarkById.get(questionId) : undefined
        if (full === undefined || !qdef) throw new Error(`复核含未知题目: ${questionId}`)
        if (
          override.score !== undefined &&
          (!Number.isFinite(override.score) || override.score < 0 || override.score > full)
        ) {
          throw new Error(`复核分数越界 [0, ${full}]: ${questionId} = ${override.score}`)
        }
        if (override.marks !== undefined) {
          if (!Array.isArray(override.marks)) throw new Error(`复核 marks 必须是数组: ${questionId}`)
          const n = qdef.presetMarks?.length ?? 0
          for (const idx of override.marks) {
            if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
              throw new Error(`复核评分点下标越界: ${questionId} = ${idx}`)
            }
          }
        }
      }
      paper.review = { ...review, reviewedAt: new Date().toISOString() }
      task.updatedAt = paper.review.reviewedAt
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /** 试卷扫描件的绝对路径(预览/P3 批改读取用) */
  paperFilePath(taskId: string, storedName: string): string {
    assertTaskId(taskId)
    if (storedName.includes('/') || storedName.includes('\\') || storedName.includes('..')) {
      throw new Error('非法存储文件名')
    }
    return path.join(this.taskFilesDir(taskId), storedName)
  }

  /** 读取试卷扫描件为 base64(复核工作台经 IPC 预览;文件导入时已限 25MB) */
  async readPaperFile(
    taskId: string,
    storedName: string,
  ): Promise<{ mime: string; base64: string }> {
    const filePath = this.paperFilePath(taskId, storedName)
    const buf = await fsp.readFile(filePath)
    const mime = `image/${path.extname(storedName).toLowerCase().replace('.', '') || 'jpeg'}`
    return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, base64: buf.toString('base64') }
  }

  /**
   * 发布批改结果进学业管线(review|published → published):
   * 首次发布创建考试并回填 publishedExamId;重复发布按
   * (examId, subjectId) 幂等 upsert。返回发布份数与跳过清单。
   */
  async publishTask(
    taskId: string,
  ): Promise<{ task: GradingTask; published: number; skipped: PublishPayload['skipped'] }> {
    assertTaskId(taskId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      if (task.status !== 'review' && task.status !== 'published') {
        throw new Error(`任务状态 ${task.status} 不可发布(需先完成批改进入复核)`)
      }
      const payload = buildPublishPayload(task)
      if (payload.records.length === 0) {
        const reasons = payload.skipped.map((s) => s.reason).join('、')
        throw new Error(`没有可发布的成绩(${reasons})`)
      }
      // 首次发布创建考试;重复发布沿用同一考试(幂等 upsert)
      let examId = task.publishedExamId
      if (!examId) {
        const exam = await academicService.createExam(payload.examInput)
        examId = exam.id
      }
      await academicService.batchSetGrades(payload.records.map((r) => ({ ...r, examId })))
      task.status = 'published'
      task.publishedExamId = examId
      task.publishedAt = new Date().toISOString()
      task.updatedAt = task.publishedAt
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      log(
        'info',
        'grading',
        `task published: ${taskId} → exam ${examId} (${payload.records.length} records, skipped ${payload.skipped.length})`,
      )
      return { task, published: payload.records.length, skipped: payload.skipped }
    })
  }

  private findPaper(task: GradingTask, paperId: string): GradingPaper {
    const paper = task.papers.find((p) => p.id === paperId)
    if (!paper) throw new Error(`试卷不存在: ${paperId}`)
    return paper
  }
}

export const gradingService = new GradingService()
