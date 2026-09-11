// =============================================================
// Grading from files — 对话一条龙: 原卷 + 作业包 → 任务/量规/导入/识别/开批
// 供 eaa_grading_from_files 工具调用;不走渲染层。
// =============================================================

import type { StudentCandidate } from '@shared/grading-helpers'
import type { RubricQuestion } from '@shared/types'
import { eaaBridge } from '../eaa-bridge'
import { materializePaperBatches, withTempDir } from './archive-import'
import { startGrading } from './grading-pipeline'
import { gradingService } from './grading-service'
import { identifyUnassignedPapers } from './identify-papers'
import { extractRubricFromImages } from './rubric-extract'

export interface GradingFromFilesInput {
  name: string
  semester?: string
  className?: string
  examDate?: string
  /** 原卷/答案扫描(图片或 PDF) */
  samplePaths: string[]
  /** 学生作业(图片 / PDF / zip) */
  homeworkPaths: string[]
  autoPublish?: boolean
}

export interface GradingFromFilesResult {
  taskId: string
  name: string
  semester: string
  rubricQuestions: number
  papers: number
  assigned: number
  unresolved: number
  gradingStarted: boolean
  autoPublish: boolean
  hint: string
}

function currentSemester(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const semester = month >= 9 || month <= 2 ? 1 : 2
  const startYear = month >= 9 ? year : year - 1
  return `${startYear}-${startYear + 1}-${semester}`
}

async function loadRoster(className?: string): Promise<StudentCandidate[]> {
  const result = await eaaBridge.execute<{
    students?: Array<{
      name?: string
      aliases?: string[]
      entity_id?: string
      groups?: string[]
      roles?: string[]
      class_id?: string
      class?: string
    }>
  }>({ command: 'list-students', args: [] })
  if (!result.success) return []
  const list = Array.isArray(result.data?.students) ? result.data.students : []
  const wanted = className?.trim()
  const out: StudentCandidate[] = []
  for (const s of list) {
    if (typeof s?.name !== 'string' || s.name.trim().length === 0) continue
    if (wanted) {
      const cls = (s.class_id ?? s.class ?? '').toString()
      if (cls.length > 0 && cls !== wanted && !cls.includes(wanted)) continue
    }
    const aliases = [
      s.entity_id,
      ...(Array.isArray(s.groups) ? s.groups : []),
      ...(Array.isArray(s.roles) ? s.roles : []),
      ...(Array.isArray(s.aliases) ? s.aliases : []),
    ].filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    out.push({ name: s.name.trim(), aliases: aliases.length > 0 ? aliases : undefined })
  }
  return out
}

function toRubric(
  extracted: Array<{ title: string; fullMark: number; referenceAnswer?: string }>,
): RubricQuestion[] {
  return extracted.map((q, i) => ({
    id: `q-${i + 1}`,
    title: q.title,
    fullMark: q.fullMark,
    referenceAnswer: q.referenceAnswer,
    order: i + 1,
  }))
}

/**
 * 创建任务 → 从原卷抽量规 → 导入作业包 → 按花名册识别归属 → 标记就绪并开批。
 * 批改是异步作业,本函数在启动后立即返回。
 */
export async function startGradingFromFiles(
  input: GradingFromFilesInput,
): Promise<GradingFromFilesResult> {
  const name = input.name.trim()
  if (!name) throw new Error('任务名不能为空')
  if (!Array.isArray(input.samplePaths) || input.samplePaths.length === 0) {
    throw new Error('请提供原卷/答案卷路径(sample_paths)')
  }
  if (!Array.isArray(input.homeworkPaths) || input.homeworkPaths.length === 0) {
    throw new Error('请提供学生作业路径(homework_paths,支持照片/PDF/zip)')
  }

  const semester = input.semester?.trim() || currentSemester()
  const task = await gradingService.createTask({
    name,
    semester,
    className: input.className?.trim() || undefined,
    examDate: input.examDate?.trim() || undefined,
  })

  const extracted = await withTempDir(async (tmp) => {
    const batches = await materializePaperBatches(
      input.samplePaths.map((p) => ({ path: p })),
      tmp,
    )
    const sampleImages = batches.flatMap((b) => b.files.map((f) => f.path)).slice(0, 8)
    return extractRubricFromImages(sampleImages)
  })
  await gradingService.updateTask(task.id, { rubric: toRubric(extracted) })

  await gradingService.importPapers(
    task.id,
    input.homeworkPaths.map((p) => ({ files: [{ path: p }] })),
  )

  const roster = await loadRoster(input.className)
  let assigned = 0
  let unresolved = 0
  if (roster.length > 0) {
    const idn = await identifyUnassignedPapers(task.id, roster)
    assigned = idn.assigned
    unresolved = idn.unresolved
  }

  const latest = await gradingService.getTask(task.id)
  const pending = latest.papers.filter((p) => p.studentName !== null).length
  if (latest.status === 'draft') {
    await gradingService.setStatus(task.id, 'ready')
  }

  let gradingStarted = false
  if (pending > 0) {
    await startGrading(task.id, null, roster, { autoPublish: input.autoPublish !== false })
    gradingStarted = true
  }

  const hint = gradingStarted
    ? '已开始 AI 批改(异步)。用 eaa_grading_overview 看进度;完成后成绩会写入学业(考试列表/学生学业页)。请到「批改作业」复核卷面批注。'
    : unresolved > 0 || pending === 0
      ? '试卷已导入但未能全部对上学生姓名。请到「批改作业」页人工归组后再开始批改。'
      : '任务已创建。'

  return {
    taskId: task.id,
    name: latest.name,
    semester,
    rubricQuestions: extracted.length,
    papers: latest.papers.length,
    assigned,
    unresolved,
    gradingStarted,
    autoPublish: input.autoPublish !== false,
    hint,
  }
}
