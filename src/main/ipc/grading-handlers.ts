// =============================================================
// Grading handlers — AI 批改任务 CRUD/试卷导入/归组/复核/批改执行
// 入参做轻量类型检查,深校验(状态机/量规/越界)在 grading-service。
// grading:run 为异步作业: 启动即返回,进度经 IPC_GRADING_PROGRESS 推送。
// =============================================================

import type { PageQuad } from '@shared/grading-geometry'
import type { StudentCandidate } from '@shared/grading-helpers'
import * as IPC from '@shared/ipc-channels'
import type {
  GradingTaskStatus,
  OverlayPrintSettings,
  RubricQuestion,
  TeacherReview,
} from '@shared/types'
import type { BrowserWindow } from 'electron'
import { abortGrading, regradePapers, startGrading } from '../services/grading/grading-pipeline'
import { gradingService } from '../services/grading/grading-service'
import { identifyUnassignedPapers } from '../services/grading/identify-papers'
import { detectQuadsForTask } from '../services/grading/page-quad-detect'
import { extractRubricFromImages } from '../services/grading/rubric-extract'
import { refineRubricStandards } from '../services/grading/rubric-refine'
import { invalidateOnExamsWrite, invalidateOnGradesWrite } from './academic/cache'
import { handleIpc } from './handle'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseRoster(v: unknown): StudentCandidate[] {
  if (!Array.isArray(v)) return []
  const out: StudentCandidate[] = []
  for (const item of v) {
    if (!isRecord(item) || typeof item.name !== 'string' || item.name.trim().length === 0) continue
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      : undefined
    out.push({ name: item.name.trim(), aliases })
  }
  return out
}

export function registerGradingHandlers(win: BrowserWindow): void {
  handleIpc(IPC.IPC_GRADING_LIST, async () => ({
    success: true,
    data: await gradingService.listTasks(),
  }))

  handleIpc(IPC.IPC_GRADING_GET, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    return { success: true, data: await gradingService.getTask(taskId) }
  })

  handleIpc(IPC.IPC_GRADING_CREATE, async (_e, input: unknown) => {
    if (!isRecord(input)) throw new Error('input 必须是对象')
    return { success: true, data: await gradingService.createTask(input as never) }
  })

  handleIpc(IPC.IPC_GRADING_UPDATE, async (_e, taskId: string, patch: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    if (!isRecord(patch)) throw new Error('patch 必须是对象')
    return { success: true, data: await gradingService.updateTask(taskId, patch as never) }
  })

  handleIpc(IPC.IPC_GRADING_DELETE, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    await gradingService.deleteTask(taskId)
    return { success: true }
  })

  handleIpc(IPC.IPC_GRADING_IMPORT_PAPERS, async (_e, taskId: string, batches: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    if (!Array.isArray(batches)) throw new Error('batches 必须是数组')
    return { success: true, data: await gradingService.importPapers(taskId, batches as never) }
  })

  handleIpc(
    IPC.IPC_GRADING_ASSIGN_PAPER,
    async (_e, taskId: string, paperId: string, studentName: string | null) => {
      if (typeof taskId !== 'string' || typeof paperId !== 'string') {
        throw new Error('taskId/paperId 必须是字符串')
      }
      if (studentName !== null && typeof studentName !== 'string') {
        throw new Error('studentName 必须是字符串或 null')
      }
      return {
        success: true,
        data: await gradingService.assignPaper(taskId, paperId, studentName),
      }
    },
  )

  handleIpc(IPC.IPC_GRADING_REMOVE_PAPER, async (_e, taskId: string, paperId: string) => {
    if (typeof taskId !== 'string' || typeof paperId !== 'string') {
      throw new Error('taskId/paperId 必须是字符串')
    }
    return { success: true, data: await gradingService.removePaper(taskId, paperId) }
  })

  handleIpc(
    IPC.IPC_GRADING_SAVE_REVIEW,
    async (_e, taskId: string, paperId: string, review: TeacherReview) => {
      if (typeof taskId !== 'string' || typeof paperId !== 'string') {
        throw new Error('taskId/paperId 必须是字符串')
      }
      if (!isRecord(review) || !isRecord(review.questions)) {
        throw new Error('review.questions 必须是对象')
      }
      return { success: true, data: await gradingService.saveReview(taskId, paperId, review) }
    },
  )

  handleIpc(IPC.IPC_GRADING_SET_STATUS, async (_e, taskId: string, status: GradingTaskStatus) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    const allowed: GradingTaskStatus[] = ['draft', 'ready', 'grading', 'review', 'published']
    if (!allowed.includes(status)) throw new Error(`非法状态: ${String(status)}`)
    return { success: true, data: await gradingService.setStatus(taskId, status) }
  })

  // 启动 AI 批改(异步作业: 校验同步完成即返回,进度经 grading:progress)
  handleIpc(IPC.IPC_GRADING_RUN, async (_e, taskId: string, roster?: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    await startGrading(taskId, win, parseRoster(roster))
    return { success: true }
  })

  // 重改指定试卷(异步作业: 覆盖上次 AI 结果与复核,进度经 grading:progress)
  handleIpc(IPC.IPC_GRADING_REGRADE, async (_e, taskId: string, paperIds: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    if (
      !Array.isArray(paperIds) ||
      paperIds.length === 0 ||
      paperIds.length > 200 ||
      paperIds.some((p) => typeof p !== 'string' || p.length === 0)
    ) {
      throw new Error('paperIds 必须是 1~200 个非空字符串')
    }
    await regradePapers(taskId, paperIds as string[], win)
    return { success: true }
  })

  // 中止批改(已完成的结果保留,可续批)
  handleIpc(IPC.IPC_GRADING_ABORT, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0)
      throw new Error('taskId 必须是非空字符串')
    return { success: true, data: abortGrading(taskId) }
  })

  // 复核工作台: 读取试卷扫描件(base64)
  handleIpc(IPC.IPC_GRADING_READ_FILE, async (_e, taskId: string, storedName: string) => {
    if (typeof taskId !== 'string' || typeof storedName !== 'string') {
      throw new Error('taskId/storedName 必须是字符串')
    }
    return { success: true, data: await gradingService.readPaperFile(taskId, storedName) }
  })

  // 发布批改结果进学业管线(成功后失效学业缓存,Agent/页面即时可见)
  handleIpc(IPC.IPC_GRADING_PUBLISH, async (_e, taskId: string) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const task = await gradingService.getTask(taskId)
    const result = await gradingService.publishTask(taskId)
    invalidateOnExamsWrite()
    invalidateOnGradesWrite(task.papers.map((p) => p.studentName ?? '').filter((n) => n.length > 0))
    return { success: true, data: result }
  })

  // 样卷识别→量规草稿(轻校验路径;扩展名/大小/存在性在 rubric-extract 深校验)
  handleIpc(IPC.IPC_GRADING_EXTRACT_RUBRIC, async (_e, paths: unknown) => {
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.length > 8 ||
      paths.some((p) => typeof p !== 'string' || p.length === 0)
    ) {
      throw new Error('paths 必须是 1~8 个非空字符串路径')
    }
    return { success: true, data: await extractRubricFromImages(paths as string[]) }
  })

  // 评分标准自动细化: 量规草稿→逐题扣分点(轻校验;结构清洗在 rubric-refine)
  handleIpc(IPC.IPC_GRADING_REFINE_RUBRIC, async (_e, questions: unknown) => {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('questions 必须是非空数组')
    }
    for (const q of questions) {
      if (
        !isRecord(q) ||
        typeof q.id !== 'string' ||
        typeof q.title !== 'string' ||
        !Number.isFinite(Number(q.fullMark))
      ) {
        throw new Error('questions 每项需含 id/title/fullMark')
      }
    }
    return {
      success: true,
      data: await refineRubricStandards(questions as RubricQuestion[]),
    }
  })

  handleIpc(IPC.IPC_GRADING_IDENTIFY_PAPERS, async (_e, taskId: string, roster: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const parsed = parseRoster(roster)
    if (parsed.length === 0) throw new Error('学生名单不能为空')
    return { success: true, data: await identifyUnassignedPapers(taskId, parsed) }
  })

  // ===== 套打回写 =====

  // 全任务定位四点检测(CV→AI 自动链;useAiFallback=false 只跑本地 CV)
  handleIpc(IPC.IPC_GRADING_DETECT_QUADS, async (_e, taskId: string, opts?: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const useAiFallback = !(isRecord(opts) && opts.useAiFallback === false)
    const results = await detectQuadsForTask(taskId, { useAiFallback })
    const task = await gradingService.getTask(taskId)
    return { success: true, data: { task, results } }
  })

  // 保存单份试卷四点(人工四点校正)
  handleIpc(
    IPC.IPC_GRADING_SAVE_QUADS,
    async (_e, taskId: string, paperId: string, quads: unknown) => {
      if (typeof taskId !== 'string' || typeof paperId !== 'string') {
        throw new Error('taskId/paperId 必须是字符串')
      }
      if (!Array.isArray(quads) || quads.length === 0) throw new Error('quads 必须是非空数组')
      return {
        success: true,
        data: await gradingService.saveOverlayQuads(
          taskId,
          paperId,
          quads as Array<PageQuad | null>,
        ),
      }
    },
  )

  // 保存套打设置(纸张规格/试打校准)
  handleIpc(
    IPC.IPC_GRADING_SAVE_OVERLAY_PRINT,
    async (_e, taskId: string, patch: OverlayPrintSettings) => {
      if (typeof taskId !== 'string' || taskId.length === 0) {
        throw new Error('taskId 必须是非空字符串')
      }
      if (!isRecord(patch)) throw new Error('patch 必须是对象')
      return {
        success: true,
        data: await gradingService.saveOverlayPrintSettings(taskId, patch as never),
      }
    },
  )
}
