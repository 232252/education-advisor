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
import { PAPER_SPECS, type PageQuad, quadIsUsable } from '@shared/grading-geometry'
import type {
  AiGradeResult,
  GradingPaper,
  GradingStrategy,
  GradingStrictness,
  GradingTask,
  GradingTaskStatus,
  OverlayPrintSettings,
  PaperFile,
  PaperIdentityRecord,
  RubricQuestion,
  TeacherReview,
} from '@shared/types'
import { atomicWrite } from '../../utils/atomic-write'
import { log } from '../../utils/logger'
import { academicService } from '../academic-service'
import { getAppPaths } from '../paths'
import { expandImportBatches, withTempDir } from './archive-import'
import { buildPublishPayload, type PublishPayload } from './publish'

/** 允许落盘的图片扩展名(zip/pdf 会先展开成这些) */
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
  published: ['review', 'grading'], // 重改 = 重跑 AI 后回复核再重新发布
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 合法批改口径(给分松紧) */
const GRADING_STRICTNESS: GradingStrictness[] = ['strict', 'normal', 'lenient']

/** 校验批改口径;undefined 放行(缺省 normal),非法值抛错 */
function assertGradingMode(mode: unknown): void {
  if (mode !== undefined && !GRADING_STRICTNESS.includes(mode as GradingStrictness)) {
    throw new Error(`非法批改口径: ${String(mode)}(strict/normal/lenient)`)
  }
}

/** 校验批改模式;undefined 放行(缺省 standard),非法值抛错 */
function assertGradingStrategy(strategy: unknown): void {
  if (
    strategy !== undefined &&
    strategy !== 'fast' &&
    strategy !== 'standard' &&
    strategy !== 'dual'
  ) {
    throw new Error(`非法批改模式: ${String(strategy)}(fast/standard/dual)`)
  }
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

/** 入参对象形状检查(四点/校准等松散结构用) */
function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
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
    gradingMode?: GradingStrictness
    gradingStrategy?: GradingStrategy
    rubric?: RubricQuestion[]
  }): Promise<GradingTask> {
    if (!input?.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new Error('任务名不能为空')
    }
    if (!input?.semester || typeof input.semester !== 'string') {
      throw new Error('学期不能为空')
    }
    assertGradingMode(input.gradingMode)
    assertGradingStrategy(input.gradingStrategy)
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
      gradingMode: input.gradingMode,
      gradingStrategy: input.gradingStrategy,
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
        | 'name'
        | 'semester'
        | 'classId'
        | 'className'
        | 'subjectId'
        | 'examDate'
        | 'gradingMode'
        | 'gradingStrategy'
        | 'rubric'
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
      if (patch.gradingMode !== undefined) {
        assertGradingMode(patch.gradingMode)
        task.gradingMode = patch.gradingMode
      }
      if (patch.gradingStrategy !== undefined) {
        assertGradingStrategy(patch.gradingStrategy)
        task.gradingStrategy = patch.gradingStrategy
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
      return withTempDir(async (tmpDir) => {
        const expanded = await expandImportBatches(batches, tmpDir)
        if (task.papers.length + expanded.length > MAX_PAPERS_PER_TASK) {
          throw new Error(`超出单任务试卷上限 ${MAX_PAPERS_PER_TASK}`)
        }
        const destDir = this.taskFilesDir(taskId)
        await fsp.mkdir(destDir, { recursive: true })
        const now = new Date().toISOString()
        for (const batch of expanded) {
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
              throw new Error(`不支持的文件类型 ${ext}(支持 jpg/png/webp/bmp/pdf/zip)`)
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
        log('info', 'grading', `papers imported: ${expanded.length} batches → ${task.id}`)
        return task
      })
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

  /** AI 结果落库(P3 管线逐份调用);分数越界在入口即拒;双评附第二模型结果与分歧清单 */
  async saveAiResult(
    taskId: string,
    paperId: string,
    result: AiGradeResult,
    extras?: { aiSecondary?: AiGradeResult; disputedQuestions?: string[] },
  ): Promise<GradingTask> {
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
      if (extras?.aiSecondary) {
        for (const q of extras.aiSecondary.questions) {
          const full = fullMarkById.get(q.questionId)
          if (full === undefined) {
            throw new Error(`双评第二模型结果含未知题目: ${q.questionId}`)
          }
          if (!Number.isFinite(q.score) || q.score < 0 || q.score > full) {
            throw new Error(`双评第二模型分数越界 [0, ${full}]: ${q.questionId} = ${q.score}`)
          }
        }
      }
      paper.ai = result
      paper.aiSecondary = extras?.aiSecondary
      paper.disputedQuestions =
        extras?.disputedQuestions && extras.disputedQuestions.length > 0
          ? extras.disputedQuestions
          : undefined
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

  /**
   * 重改前置重置: 清掉上次的 AI 结果/复核/失败原因,回到 pending。
   * 归属(studentName/identity)与扫描件保留;已发布任务重改后需重新发布。
   */
  async resetPaperForRegrade(taskId: string, paperId: string): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      if (task.status === 'grading') throw new Error('任务正在批改中,不能重改')
      const paper = this.findPaper(task, paperId)
      if (paper.files.length === 0) throw new Error('该试卷没有扫描件,无法重改')
      paper.ai = undefined
      paper.aiSecondary = undefined
      paper.disputedQuestions = undefined
      paper.review = undefined
      paper.error = undefined
      paper.status = 'pending'
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /**
   * 重改失败回滚: 恢复重置前的 AI 结果/复核,不让一次模型抽风把旧结果丢掉。
   * 仅 grading/review 态可写(重改作业失败/中止路径专用)。
   */
  async applyPaperSnapshot(
    taskId: string,
    paperId: string,
    snap: {
      ai?: GradingPaper['ai']
      aiSecondary?: GradingPaper['aiSecondary']
      disputedQuestions?: GradingPaper['disputedQuestions']
      review?: GradingPaper['review']
      error?: string
      status: GradingPaper['status']
    },
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    if (!['unassigned', 'pending', 'graded', 'failed'].includes(snap.status)) {
      throw new Error(`非法试卷状态: ${String(snap.status)}`)
    }
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      if (task.status !== 'grading' && task.status !== 'review') {
        throw new Error(`任务状态 ${task.status} 不可回滚试卷`)
      }
      const paper = this.findPaper(task, paperId)
      paper.ai = snap.ai
      paper.aiSecondary = snap.aiSecondary
      paper.disputedQuestions = snap.disputedQuestions
      paper.review = snap.review
      paper.error = snap.error
      paper.status = snap.status
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /**
   * 卷面身份识别留痕:读到什么记什么(归组成功与否都写),
   * 供复核台/试卷表回显与排查;不影响 status/studentName。
   */
  async savePaperIdentity(
    taskId: string,
    paperId: string,
    identity: PaperIdentityRecord,
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    if (!identity || typeof identity !== 'object') throw new Error('identity 必须是对象')
    for (const key of ['name', 'number'] as const) {
      if (typeof identity[key] !== 'string') throw new Error(`identity.${key} 必须是字符串`)
    }
    if (
      !Array.isArray(identity.candidates) ||
      identity.candidates.some((c) => typeof c !== 'string')
    ) {
      throw new Error('identity.candidates 必须是字符串数组')
    }
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      paper.identity = {
        name: identity.name,
        number: identity.number,
        candidates: identity.candidates,
        ...(identity.matched ? { matched: identity.matched } : {}),
        readAt: identity.readAt || new Date().toISOString(),
      }
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  // ===== 套打回写(定位四点/设置) =====

  /** 校验并净化单页四点(非法返回 null) */
  private sanitizeQuad(v: unknown): PageQuad | null {
    if (v === null) return null
    if (!isRecordLike(v)) return null
    const source = v.source
    if (source !== 'corner' && source !== 'anchors' && source !== 'ai' && source !== 'manual') {
      return null
    }
    const pt = (p: unknown): { x: number; y: number } | null => {
      if (!isRecordLike(p)) return null
      const x = Number(p.x)
      const y = Number(p.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return { x, y }
    }
    const tl = pt(v.tl)
    const tr = pt(v.tr)
    const br = pt(v.br)
    const bl = pt(v.bl)
    const imageWidth = Number(v.imageWidth)
    const imageHeight = Number(v.imageHeight)
    const confidence = Number(v.confidence)
    if (!tl || !tr || !br || !bl) return null
    if (!Number.isFinite(imageWidth) || imageWidth <= 0) return null
    if (!Number.isFinite(imageHeight) || imageHeight <= 0) return null
    const quad: PageQuad = {
      tl,
      tr,
      br,
      bl,
      source,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
      imageWidth,
      imageHeight,
      ...(typeof v.detectedAt === 'string' && v.detectedAt.length > 0
        ? { detectedAt: v.detectedAt }
        : {}),
    }
    // 人工四点是最终真相,不再过几何可用性检查
    if (source !== 'manual' && !quadIsUsable(quad)) return null
    return quad
  }

  /**
   * 套打定位四点落库(页下标对齐;自动检测/人工四点共用)。
   * 单页不可用存 null(渲染层显示失败列表);整份无文件抛错。
   */
  async saveOverlayQuads(
    taskId: string,
    paperId: string,
    quads: Array<PageQuad | null>,
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    assertPaperId(paperId)
    if (!Array.isArray(quads) || quads.length === 0) throw new Error('quads 必须是非空数组')
    if (quads.length > 20) throw new Error('单份试卷页数异常(>20)')
    const cleaned = quads.map((q) => this.sanitizeQuad(q))
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const paper = this.findPaper(task, paperId)
      if (paper.files.length === 0) throw new Error('该试卷没有扫描件')
      paper.overlayQuads = cleaned
      task.updatedAt = new Date().toISOString()
      await atomicWrite(this.taskPath(taskId), JSON.stringify(task, null, 2))
      return task
    })
  }

  /** 套打设置落库(纸张规格 + 试打校准);打印属读侧操作,不限任务状态 */
  async saveOverlayPrintSettings(
    taskId: string,
    patch: OverlayPrintSettings,
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    if (patch.paperSpecId !== undefined) {
      if (!PAPER_SPECS.some((s) => s.id === patch.paperSpecId)) {
        throw new Error(`非法纸张规格: ${String(patch.paperSpecId)}`)
      }
    }
    if (patch.deviceName !== undefined) {
      if (typeof patch.deviceName !== 'string' || patch.deviceName.length > 200) {
        throw new Error('deviceName 必须是 ≤200 字符的字符串')
      }
    }
    if (patch.calibration !== undefined) {
      const c = patch.calibration
      if (!isRecordLike(c)) throw new Error('calibration 必须是对象')
      const scale = Number(c.scalePct)
      const dx = Number(c.dxMm)
      const dy = Number(c.dyMm)
      if (!Number.isFinite(scale) || scale < 90 || scale > 110) {
        throw new Error('scalePct 必须在 90–110 之间')
      }
      if (!Number.isFinite(dx) || Math.abs(dx) > 30) throw new Error('dxMm 必须在 ±30mm 内')
      if (!Number.isFinite(dy) || Math.abs(dy) > 30) throw new Error('dyMm 必须在 ±30mm 内')
    }
    const nextSpecId = patch.paperSpecId
    const nextCalibration = patch.calibration
    const nextDevice = patch.deviceName
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      const current: OverlayPrintSettings = { ...(task.overlayPrint ?? {}) }
      if (nextSpecId !== undefined) current.paperSpecId = nextSpecId
      if (nextCalibration !== undefined) current.calibration = nextCalibration
      if (nextDevice !== undefined) current.deviceName = nextDevice
      task.overlayPrint = current
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
          if (!Array.isArray(override.marks))
            throw new Error(`复核 marks 必须是数组: ${questionId}`)
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

  /** 母版样卷目录(files/<taskId>/template/) */
  templateDirPath(taskId: string): string {
    assertTaskId(taskId)
    return path.join(this.taskFilesDir(taskId), 'template')
  }

  /**
   * 母版标定落库: 文件档案 + 每页四点 + 逐题作答区。
   * 深校验(quads 走 sanitizeQuad;boxes 坐标钳制 0-1 且题号须在量规内)。
   */
  async saveOverlayTemplate(
    taskId: string,
    template: {
      files: PaperFile[]
      quads?: Array<PageQuad | null>
      boxes?: Record<string, import('@shared/types').GradeAnnotationBox>
      calibratedAt?: string
    },
  ): Promise<GradingTask> {
    assertTaskId(taskId)
    if (!Array.isArray(template.files) || template.files.length === 0) {
      throw new Error('template.files 必须是非空数组')
    }
    if (template.files.length > 20) throw new Error('样卷页数异常(>20)')
    for (const f of template.files) {
      if (
        !isRecordLike(f) ||
        typeof f.name !== 'string' ||
        typeof f.storedName !== 'string' ||
        typeof f.mime !== 'string' ||
        !Number.isFinite(Number(f.bytes))
      ) {
        throw new Error('template.files 每项需含 name/storedName/mime/bytes')
      }
      if (
        f.storedName.includes('/') ||
        f.storedName.includes('\\') ||
        f.storedName.includes('..')
      ) {
        throw new Error('非法样卷存储名')
      }
    }
    const quads = Array.isArray(template.quads)
      ? template.quads.map((q) => this.sanitizeQuad(q))
      : undefined
    let boxes: Record<string, import('@shared/types').GradeAnnotationBox> | undefined
    if (template.boxes && typeof template.boxes === 'object') {
      const task = await this.getTask(taskId)
      const known = new Set(task.rubric.map((q) => q.id))
      const clean: Record<string, import('@shared/types').GradeAnnotationBox> = {}
      for (const [qid, box] of Object.entries(template.boxes)) {
        if (!known.has(qid) || !isRecordLike(box)) continue
        const x = Number(box.x)
        const y = Number(box.y)
        const w = Number(box.w)
        const h = Number(box.h)
        const page = Number(box.page)
        if (![x, y, w, h].every(Number.isFinite)) continue
        clean[qid] = {
          page: Number.isInteger(page) && page >= 0 ? page : 0,
          x: Math.min(Math.max(x, 0), 1),
          y: Math.min(Math.max(y, 0), 1),
          w: Math.min(Math.max(w, 0.02), 1),
          h: Math.min(Math.max(h, 0.02), 1),
        }
      }
      boxes = clean
    }
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTask(taskId)
      task.overlayTemplate = {
        files: template.files,
        ...(quads ? { quads } : {}),
        ...(boxes ? { boxes } : {}),
        ...(typeof template.calibratedAt === 'string' && template.calibratedAt.length > 0
          ? { calibratedAt: template.calibratedAt }
          : {}),
      }
      task.updatedAt = new Date().toISOString()
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
