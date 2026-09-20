// =============================================================
// Grading handlers — AI 批改任务 CRUD/试卷导入/归组/复核/批改执行
// 入参做轻量类型检查,深校验(状态机/量规/越界)在 grading-service。
// grading:run 为异步作业: 启动即返回,进度经 IPC_GRADING_PROGRESS 推送。
// =============================================================

import fsp from 'node:fs/promises'
import {
  type PageQuad,
  paperSpecById,
  paperSpecToPdfPageSize,
  paperSpecToPrintPageSize,
} from '@shared/grading-geometry'
import { isPrintDuplexMode, isPrintOrder, type StudentCandidate } from '@shared/grading-helpers'
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
import { extractRubricFromSamples } from '../services/grading/rubric-extract'
import { refineRubricStandards } from '../services/grading/rubric-refine'
import { buildSummaryCsv } from '../services/grading/summary-export'
import { calibrateOverlayTemplate } from '../services/grading/template-calibrate'
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

  // 多页归组人工合并: source 卷页面并入 anchor 卷(appendPaperPages 拒绝已批改卷)
  handleIpc(
    IPC.IPC_GRADING_MERGE_PAPERS,
    async (_e, taskId: string, anchorId: string, sourceId: string) => {
      if (
        typeof taskId !== 'string' ||
        typeof anchorId !== 'string' ||
        typeof sourceId !== 'string'
      ) {
        throw new Error('taskId/anchorId/sourceId 必须是字符串')
      }
      return {
        success: true,
        data: await gradingService.appendPaperPages(taskId, anchorId, sourceId),
      }
    },
  )

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
    return { success: true, data: await extractRubricFromSamples(paths as string[]) }
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

  // 母版标定: 样卷留档 + AI 模板逐题定位(视觉模型)
  handleIpc(IPC.IPC_GRADING_CALIBRATE_TEMPLATE, async (_e, taskId: string, paths: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.length > 8 ||
      paths.some((p) => typeof p !== 'string' || p.length === 0)
    ) {
      throw new Error('paths 必须是 1~8 个非空字符串路径')
    }
    const result = await calibrateOverlayTemplate(taskId, paths as string[])
    const task = await gradingService.getTask(taskId)
    return { success: true, data: { task, result } }
  })

  // 静默连打: 打印当前窗口(套打模式 DOM 已由打印 CSS 滤成纯红痕层);
  // 参数写死 实际尺寸+无边距,根除驱动「适合页面」缩放风险;
  // duplexMode 透传 electron print 同名字段(字段名是 duplexMode 非 duplex),
  // order 为连打排序留档(渲染层已按该序渲染)——两者都做值域校验,
  // 传了非法值直接抛错,防 UI 契约漂移
  handleIpc(IPC.IPC_GRADING_OVERLAY_SILENT_PRINT, async (_e, taskId: string, opts: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const o = isRecord(opts) ? opts : {}
    const specId = typeof o.paperSpecId === 'string' ? o.paperSpecId : undefined
    const deviceName =
      typeof o.deviceName === 'string' && o.deviceName.length > 0 ? o.deviceName : undefined
    if (o.order !== undefined && !isPrintOrder(o.order)) {
      throw new Error('非法 order(合法值 name-asc|name-desc|upload-asc)')
    }
    if (o.duplexMode !== undefined && !isPrintDuplexMode(o.duplexMode)) {
      throw new Error('非法 duplexMode(合法值 simplex|shortEdge|longEdge)')
    }
    const duplexMode = isPrintDuplexMode(o.duplexMode) ? o.duplexMode : undefined
    // pageSize 维持微米口径(paperSpecToPrintPageSize 服务 webContents.print)
    const pageSize = paperSpecToPrintPageSize(paperSpecById(specId))
    return await new Promise<{ success: boolean; data?: { ok: boolean; reason?: string } }>(
      (resolve) => {
        win.webContents.print(
          {
            silent: true,
            deviceName,
            pageSize,
            margins: { marginType: 'none' },
            printBackground: true,
            ...(duplexMode ? { duplexMode } : {}),
          },
          (ok, reason) => resolve({ success: true, data: { ok, reason } }),
        )
      },
    )
  })

  // 成绩汇总 CSV: 路径来自渲染层保存对话框;纯函数 builder + 主进程写盘
  // (内容自带 \uFEFF,utf-8 写出即 utf-8-sig,Excel 双击直开)
  handleIpc(IPC.IPC_GRADING_EXPORT_SUMMARY_CSV, async (_e, taskId: string, filePath: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('filePath 必须是非空字符串')
    }
    const task = await gradingService.getTask(taskId)
    const csv = buildSummaryCsv(task)
    await fsp.writeFile(filePath, csv, 'utf-8')
    return { success: true, data: { bytes: Buffer.byteLength(csv, 'utf-8') } }
  })

  // 逐页批注 PDF 直出: 把当前窗口(打印 CSS 下的批注文档)打成 PDF 落盘。
  // pageSize 走 paperSpecToPdfPageSize——printToPDF 的数字对象单位是英寸,
  // 与 print 的微米口径(paperSpecToPrintPageSize)互斥,禁止跨 API 复用。
  handleIpc(IPC.IPC_GRADING_EXPORT_ANNOTATED_PDF, async (_e, taskId: string, opts: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('taskId 必须是非空字符串')
    }
    const o = isRecord(opts) ? opts : {}
    if (typeof o.filePath !== 'string' || o.filePath.length === 0) {
      throw new Error('filePath 必须是非空字符串')
    }
    if (o.duplexMode !== undefined && !isPrintDuplexMode(o.duplexMode)) {
      throw new Error('非法 duplexMode(合法值 simplex|shortEdge|longEdge)')
    }
    await gradingService.getTask(taskId)
    const specId = typeof o.paperSpecId === 'string' ? o.paperSpecId : undefined
    const duplexMode = isPrintDuplexMode(o.duplexMode) ? o.duplexMode : undefined
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      pageSize: paperSpecToPdfPageSize(paperSpecById(specId)),
      ...(duplexMode ? { duplexMode } : {}),
    })
    await fsp.writeFile(o.filePath, pdf)
    return { success: true, data: { bytes: pdf.length } }
  })
}
