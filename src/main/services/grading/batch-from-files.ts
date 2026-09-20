// =============================================================
// Grading from files — 对话一条龙: 原卷 + 作业包 → 任务/量规/导入/识别/开批
// 供 eaa_grading_from_files 工具调用;不走渲染层。
// 多页归组: PDF 每页一批拆份后,identify 管线按卷面身份合并续页。
// =============================================================

import type { StudentCandidate } from '@shared/grading-helpers'
import type { GradingStrictness, RubricQuestion } from '@shared/types'
import { eaaBridge } from '../eaa-bridge'
import { startGrading } from './grading-pipeline'
import { gradingService } from './grading-service'
import { identifyUnassignedPapers } from './identify-papers'
import { parseRosterFile } from './roster-file'
import { extractRubricFromSamples } from './rubric-extract'

export interface GradingFromFilesInput {
  name: string
  semester?: string
  className?: string
  examDate?: string
  /** 批改口径(给分松紧);缺省 normal */
  gradingMode?: GradingStrictness
  /** 原卷/答案扫描(图片或 PDF) */
  samplePaths: string[]
  /** 学生作业(图片 / PDF / zip) */
  homeworkPaths: string[]
  /** 花名册文件(xlsx/xls/csv/md/txt/yaml;缺省只用 eaa 学生名单,两者合并去重) */
  rosterPaths?: string[]
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
  /** 单学生多页: 续页并入该生名下卷的份数 */
  merged: number
  /** 唯一命中但该生名下卷已批改(补录)的学生名 */
  duplicates: string[]
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

// ===== 花名册 =====

/** 文件花名册 + eaa 学生名单合并去重(姓名为准,别名并集,文件在前保持顺序) */
function mergeRosters(
  fromFiles: StudentCandidate[],
  fromBridge: StudentCandidate[],
): StudentCandidate[] {
  const byName = new Map<string, StudentCandidate>()
  for (const s of [...fromFiles, ...fromBridge]) {
    const existing = byName.get(s.name)
    if (!existing) {
      byName.set(s.name, {
        name: s.name,
        aliases: s.aliases && s.aliases.length > 0 ? [...s.aliases] : undefined,
      })
      continue
    }
    const aliases = [...new Set([...(existing.aliases ?? []), ...(s.aliases ?? [])])]
    existing.aliases = aliases.length > 0 ? aliases : undefined
  }
  return [...byName.values()]
}

/**
 * 花名册来源合并: 本地名册文件(roster_paths,compat 面 parseRosterFile:
 * xlsx/xls/csv/md/txt/yaml,含 GBK 兜底)优先,eaa 学生名单兜底,
 * 同名学生并别名去重(文件在前保持顺序)。
 */
async function loadRosterWithFiles(
  className?: string,
  rosterPaths?: string[],
): Promise<StudentCandidate[]> {
  const fromFiles: StudentCandidate[] = []
  for (const p of rosterPaths ?? []) {
    if (typeof p !== 'string' || p.trim().length === 0) continue
    fromFiles.push(...(await parseRosterFile(p)))
  }
  const fromBridge = await loadRoster(className)
  return mergeRosters(fromFiles, fromBridge)
}

/** eaa 学生名单(可按班级名过滤) */
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
    // 卷面只会出现姓名/学号/考号: entity_id(十六进制)/群组/角色对身份匹配
    // 没有意义,混进别名反而污染编号匹配(09-13 实测 ent_xxx01 误中考号 01)。
    const aliases = (Array.isArray(s.aliases) ? s.aliases : []).filter(
      (a): a is string => typeof a === 'string' && a.trim().length > 0,
    )
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
    gradingMode: input.gradingMode,
  })

  // 样卷直接走 sample-ingest 摄取(图片/PDF/docx/md/txt;zip 由 isSampleExt 兜住)
  const extracted = await extractRubricFromSamples(input.samplePaths)
  await gradingService.updateTask(task.id, { rubric: toRubric(extracted) })

  await gradingService.importPapers(
    task.id,
    input.homeworkPaths.map((p) => ({ files: [{ path: p }] })),
  )

  const roster = await loadRosterWithFiles(input.className, input.rosterPaths)
  let assigned = 0
  let unresolved = 0
  let merged = 0
  let duplicates: string[] = []
  if (roster.length > 0) {
    const idn = await identifyUnassignedPapers(task.id, roster)
    assigned = idn.assigned
    unresolved = idn.unresolved
    merged = idn.merged
    duplicates = idn.duplicates
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

  const warnings: string[] = []
  if (merged > 0) warnings.push(`已按卷面姓名自动合并 ${merged} 页续页到同名卷`)
  if (duplicates.length > 0) {
    warnings.push(
      `检测到 ${duplicates.length} 份疑似补录/重复卷(${[...new Set(duplicates)].join('、')})未并入,请到「批改作业」页人工处理`,
    )
  }
  const warningText = warnings.length > 0 ? `${warnings.join(';')}。` : ''
  let hint: string
  if (gradingStarted) {
    hint =
      '已开始 AI 批改(异步)。用 eaa_grading_overview 看进度;完成后成绩会写入学业(考试列表/学生学业页)。请到「批改作业」复核卷面批注。' +
      warningText
  } else if (roster.length === 0) {
    hint =
      '花名册为空(eaa 学生名单为空且未提供可解析的 roster_paths):全部试卷未归组。' +
      '请先在「学生」页导入名册或提供花名册文件,再到「批改作业」页人工归组后再开始批改。'
  } else if (unresolved > 0 || pending === 0) {
    hint = `试卷已导入但未能全部对上学生姓名。请到「批改作业」页人工归组后再开始批改。${warningText}`
  } else {
    hint = `任务已创建。${warningText}`
  }

  return {
    taskId: task.id,
    name: latest.name,
    semester,
    rubricQuestions: extracted.length,
    papers: latest.papers.length,
    assigned,
    unresolved,
    merged,
    duplicates,
    gradingStarted,
    autoPublish: input.autoPublish !== false,
    hint,
  }
}
