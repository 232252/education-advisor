// =============================================================
// 套打版式(纯函数,无 electron 依赖,渲染层/测试共用)
// 把现有批改结果(逐题分/扣分说明/评语/总分)排成「打回原卷」的
// 无底图红痕版: 每题短痕贴作答区角外 + 页边批注(自适应降级) + 总分大字。
//
// 版式规范(2026-09-15 与用户对齐):
//   - 字号层级而非硬性下限: 总分大字(≈20pt, "/满分"半号) > ✓/✗(13pt)
//     > 题分(11.5pt) > 页边批注小字(8pt, 六号字级别, 中文注释字号惯例);
//   - 自适应只压内容不缩字号: 先压行距空间 → 丢评语 → 截扣分 → 只留序号+分数,
//     装不下转批阅报告(现有 report 模式兜底);
//   - 页边批注栏宽按「该页内容右缘 → 纸右安全线」实际计算,CJK 逐字断行;
//   - 落点边界: 硬件不可打印区外(≥6mm)、安全线内、防重叠整行步进。
// 出处: docs/research/2026-09-15-overlay-print-annotation-research.md §4.2
// =============================================================

import { type PageQuad, type PaperSpec, quadToPaperMapper } from './grading-geometry'
import {
  aiResultByQuestion,
  effectiveTotalScore,
  paperMarkScoreRows,
  questionKind,
  rubricFullMark,
} from './grading-helpers'
import type { GradeAnnotationBox, GradingPaper, OverlayTemplate, RubricQuestion } from './types'

/** 字号层级(pt;CSS 直接用 pt 单位,1pt=0.3528mm) */
export interface OverlayTypography {
  /** 总分主字(如 "86") */
  totalPt: number
  /** 总分斜杠后的满分小字(如 "/100") */
  totalSubPt: number
  /** ✓ / ✗ 符号 */
  symbolPt: number
  /** 每题分数(如 "9/12") */
  scorePt: number
  /** 页边批注小字(六号字级别) */
  notePt: number
  /** 批注行高倍数 */
  noteLineHeight: number
}

export const DEFAULT_OVERLAY_TYPOGRAPHY: OverlayTypography = {
  totalPt: 20,
  totalSubPt: 10,
  symbolPt: 13,
  scorePt: 11.5,
  notePt: 8,
  noteLineHeight: 1.35,
}

/** 试打校准: 整体缩放(%) + 全局平移(mm);由校准页实测录入,按任务记忆 */
export interface OverlayCalibration {
  dxMm: number
  dyMm: number
  scalePct: number
}

export const DEFAULT_OVERLAY_CALIBRATION: OverlayCalibration = { dxMm: 0, dyMm: 0, scalePct: 100 }

/** 落点安全边界(mm);6mm=硬件不可打印区外,8–12mm=安全线 */
export const OVERLAY_SAFE = {
  /** 任何痕迹不落入的硬件死区(保守 6mm) */
  hardEdgeMm: 6,
  /** 批注/总分的常规安全线 */
  edgeMm: 8,
  /** 总分/页首留白 */
  topMm: 10,
  /** 页底留白 */
  bottomMm: 12,
} as const

/** 每题短痕(✓/✗/分数),贴作答区角外 */
export interface OverlayMarkElement {
  questionId: string
  page: number
  xMm: number
  yMm: number
  pt: number
  text: string
  kind: 'symbol' | 'score'
}

/** 页边批注块: 首行「① 9/12」,后续行为扣分说明(悬挂缩进由渲染层实现) */
export interface OverlayNoteElement {
  questionId: string
  page: number
  index: number
  header: string
  lines: string[]
  xMm: number
  yMm: number
  pt: number
  lineHeightMm: number
  widthMm: number
}

/** 总分(必打;首页右上安全区内) */
export interface OverlayTotalElement {
  page: 0
  xMm: number
  yMm: number
  mainPt: number
  subPt: number
  mainText: string
  subText: string
}

export interface OverlayPageLayout {
  page: number
  marks: OverlayMarkElement[]
  notes: OverlayNoteElement[]
}

export interface OverlayPaperLayout {
  paperId: string
  pages: OverlayPageLayout[]
  total: OverlayTotalElement | null
  warnings: string[]
}

export interface OverlayLayoutInput {
  paper: Pick<GradingPaper, 'id' | 'ai' | 'review'>
  rubric: RubricQuestion[]
  /**
   * 母版标定(Tier B): 有 boxes+四点时痕迹位统一走模板坐标
   * (消除逐卷 AI box 抖动,学生卷无需自己的四点);模板缺的题回落 AI box。
   */
  template?: Pick<OverlayTemplate, 'boxes' | 'quads'>
  /** 每页基准四点(页下标对齐;null/缺 = 该页无定位;有模板时可缺) */
  quads: Array<PageQuad | null | undefined>
  /** 每页扫描图自然像素尺寸(页下标对齐) */
  imageSizes: Array<{ width: number; height: number } | undefined>
  spec: PaperSpec
  calibration?: Partial<OverlayCalibration>
  typography?: Partial<OverlayTypography>
}

// ===== 文本度量近似 =====

/** 单字宽(em 倍数): CJK 全宽 1em,ASCII 数字/符号约 0.55em */
export function charEmWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code > 0x2e7f) return 1 // CJK 及全角
  if (ch >= '0' && ch <= '9') return 0.55
  if (ch === '/' || ch === ' ') return 0.4
  return 0.55
}

/** 文本宽度近似(mm) */
export function estimateTextWidthMm(text: string, pt: number): number {
  let em = 0
  for (const ch of text) em += charEmWidth(ch)
  return em * pt * 0.3528
}

/** CJK 逐字断行(每行不超过 maxChars 个 em;标点跟随) */
export function wrapCjkText(text: string, maxEmWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  let curEm = 0
  for (const ch of text) {
    const w = charEmWidth(ch)
    if (cur.length > 0 && curEm + w > maxEmWidth) {
      lines.push(cur)
      cur = ch
      curEm = w
    } else {
      cur += ch
      curEm += w
    }
  }
  if (cur.length > 0) lines.push(cur)
  return lines
}

/** 圈号 ①②③…(超过 20 用 (n)) */
export function circleNumber(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1)
  return `(${n})`
}

// ===== 自适应降级链 =====

/** 批注正文候选(从长到短: 扣分+评语 → 扣分 → 截断扣分) */
function noteBodyCandidates(deductionNotes: string[], comment: string): string[] {
  const deductions = deductionNotes.join('；')
  const body = [deductions, comment].filter((s) => s.length > 0).join('；')
  const out: string[] = []
  if (body.length > 0) out.push(body)
  if (deductions.length > 0) out.push(deductions)
  return out
}

/** 按可用行数挑选最长能放下的候选;都放不下返回空(只留首行) */
function pickBodyLines(candidates: string[], maxEmWidth: number, linesAvail: number): string[] {
  for (const text of candidates) {
    const lines = wrapCjkText(text, maxEmWidth)
    if (lines.length <= linesAvail) return lines
    if (linesAvail > 0) {
      // 截断到可用行数,末行补省略号
      const cut = lines.slice(0, linesAvail)
      cut[cut.length - 1] = `${cut[cut.length - 1]}…`
      return cut
    }
  }
  return []
}

// ===== 主布局 =====

interface NoteDraft {
  questionId: string
  /** 期望落点: 题目作答区映射后的 y(mm) */
  yMm: number
  header: string
  deductionNotes: string[]
  comment: string
  index: number
}

export function layoutOverlayPaper(input: OverlayLayoutInput): OverlayPaperLayout {
  const typo = { ...DEFAULT_OVERLAY_TYPOGRAPHY, ...input.typography }
  const calib = { ...DEFAULT_OVERLAY_CALIBRATION, ...input.calibration }
  const scale = calib.scalePct / 100
  const { paper, rubric, spec } = input
  const warnings: string[] = []
  const pages: OverlayPageLayout[] = []
  const aiMaxPage = paper.ai?.questions.reduce((m, q) => Math.max(m, q.box?.page ?? 0), -1) ?? -1
  const pageCount = Math.max(input.quads.length, input.imageSizes.length, aiMaxPage + 1)

  const rows = paperMarkScoreRows(paper, rubric)
  const aiById = aiResultByQuestion(paper.ai)
  const noteLineMm = typo.notePt * 0.3528 * typo.noteLineHeight
  const noteGapMm = noteLineMm * 0.6

  // 母版标定: 模板图 → 纸毫米 的统一映射(逐页,页下标对齐模板页)
  const templateBoxes = input.template?.boxes
  const templateMappers = (input.template?.quads ?? []).map((q) =>
    q ? quadToPaperMapper(q, spec) : null,
  )

  for (let page = 0; page < pageCount; page++) {
    const quad = input.quads[page]
    const size = input.imageSizes[page]
    const templateMapper = templateMappers[page] ?? null
    const marks: OverlayMarkElement[] = []
    const notes: OverlayNoteElement[] = []
    if ((!quad || !size) && !templateMapper) {
      const orphaned = rows.filter((r) => {
        const box = aiById.get(r.questionId)?.box
        return box && (box.page ?? 0) === page && r.score !== null
      })
      if (orphaned.length > 0) {
        warnings.push(
          `第 ${page + 1} 页没有定位四点,${orphaned.length} 处痕迹未排(请重检或手动四点)`,
        )
      }
      pages.push({ page, marks, notes })
      continue
    }

    const mapper = templateMapper ?? (quad ? quadToPaperMapper(quad, spec) : null)
    if (!mapper) {
      warnings.push(`第 ${page + 1} 页四点退化,无法换算(请手动四点或标定母版)`)
      pages.push({ page, marks, notes })
      continue
    }

    // --- 每题短痕 + 批注草稿 ---
    const drafts: NoteDraft[] = []
    let contentRightMm = 0
    for (const row of rows) {
      const ai = aiById.get(row.questionId)
      const box: GradeAnnotationBox | undefined = templateBoxes?.[row.questionId] ?? ai?.box
      if (!box || (box.page ?? 0) !== page || row.score === null) continue
      const def = rubric.find((r) => r.id === row.questionId)
      const kind = questionKind({ title: row.title, type: def?.type })
      const scoreText = `${row.score}/${row.fullMark}`
      let text: string
      let markKind: 'symbol' | 'score'
      if (row.fullMark > 0 && row.score >= row.fullMark) {
        text = '✓'
        markKind = 'symbol'
      } else if (row.score <= 0) {
        text = '✗'
        markKind = 'symbol'
      } else {
        text = scoreText
        markKind = 'score'
      }
      const pt = markKind === 'symbol' ? typo.symbolPt : typo.scorePt
      const widthMm = estimateTextWidthMm(text, pt)

      // 贴作答区右上角外;太靠右纸边则换到左上角外
      const rightTop = mapper(Math.min(box.x + box.w, 1), Math.max(box.y, 0))
      let x = rightTop.x + 2
      let y = rightTop.y - pt * 0.3528 * 0.9
      if (x + widthMm > spec.widthMm - OVERLAY_SAFE.hardEdgeMm) {
        const leftTop = mapper(Math.max(box.x, 0), Math.max(box.y, 0))
        x = leftTop.x - 2 - widthMm
        y = leftTop.y - pt * 0.3528 * 0.9
      }
      marks.push({
        questionId: row.questionId,
        page,
        xMm: clamp(
          x,
          OVERLAY_SAFE.hardEdgeMm,
          Math.max(OVERLAY_SAFE.hardEdgeMm, spec.widthMm - OVERLAY_SAFE.hardEdgeMm - widthMm),
        ),
        yMm: clamp(y, OVERLAY_SAFE.hardEdgeMm, spec.heightMm - OVERLAY_SAFE.hardEdgeMm),
        pt,
        text,
        kind: markKind,
      })

      // 内容右缘(批注栏起点依据)
      const br = mapper(Math.min(box.x + box.w, 1), Math.min(box.y + box.h, 1))
      contentRightMm = Math.max(contentRightMm, br.x)

      // 页边批注: 仅主观题且非全对(与 paperMarkOverlays 口径一致)
      if (kind === 'subjective' && row.score < row.fullMark) {
        const center = mapper(box.x + box.w / 2, box.y + box.h / 2)
        drafts.push({
          questionId: row.questionId,
          yMm: center.y,
          header: scoreText,
          deductionNotes: row.deductionNotes,
          comment: row.comment || row.evidence || '',
          index: 0,
        })
      }
    }

    // --- 批注栏: [内容右缘+3, 纸右-8],宽不足 8mm 整体放弃 ---
    const colRight = spec.widthMm - OVERLAY_SAFE.edgeMm
    const colLeftRaw = contentRightMm > 0 ? contentRightMm + 3 : spec.widthMm * 0.84
    let colLeft = Math.min(Math.max(colLeftRaw, colRight - 30), colRight - 8)
    if (colLeft < spec.widthMm * 0.5) colLeft = spec.widthMm * 0.5
    const colWidth = colRight - colLeft
    if (drafts.length > 0 && colWidth < 8) {
      warnings.push(`第 ${page + 1} 页页边不足 8mm,批注转批阅报告`)
      drafts.length = 0
    }

    // --- 批注自适应排布(按 y 排序、防重叠整行步进、降级链) ---
    drafts.sort((a, b) => a.yMm - b.yMm)
    const bottomLimit = spec.heightMm - OVERLAY_SAFE.bottomMm
    const maxEm = colWidth / (typo.notePt * 0.3528)
    let prevBottom: number = OVERLAY_SAFE.topMm
    drafts.forEach((d, i) => {
      d.index = i + 1
      const headerText = `${circleNumber(d.index)} ${d.header}`
      const desired = Math.max(d.yMm - noteLineMm / 2, prevBottom + noteGapMm)
      const spanToNext =
        i + 1 < drafts.length ? Math.max(drafts[i + 1].yMm - desired, 0) : bottomLimit - desired
      const linesAvail =
        spanToNext > noteLineMm ? Math.floor((spanToNext - noteLineMm) / noteLineMm) : 0
      const lines = pickBodyLines(
        noteBodyCandidates(d.deductionNotes, d.comment),
        maxEm,
        linesAvail,
      )
      const headerWidth = estimateTextWidthMm(headerText, typo.notePt)
      const blockHeight = noteLineMm * (1 + lines.length)
      const bottom = desired + blockHeight
      if (desired + noteLineMm > bottomLimit) {
        warnings.push(
          `第 ${page + 1} 页批注${circleNumber(d.index)}(题 ${d.header})超出页底,已转批阅报告`,
        )
        prevBottom = desired
        return
      }
      notes.push({
        questionId: d.questionId,
        page,
        index: d.index,
        header: headerText,
        lines,
        xMm: colLeft,
        yMm: desired,
        pt: typo.notePt,
        lineHeightMm: noteLineMm,
        widthMm: Math.min(colWidth, Math.max(headerWidth, maxLineWidthMm(lines, typo.notePt))),
      })
      prevBottom = bottom
    })

    pages.push({ page, marks, notes })
  }

  // --- 总分: 首页右上安全区 ---
  let total: OverlayTotalElement | null = null
  const totalScore = effectiveTotalScore(paper)
  if (totalScore !== null) {
    const fullMark = rubricFullMark(rubric)
    const mainText = String(totalScore)
    const subText = `/${fullMark}`
    const widthMm =
      estimateTextWidthMm(mainText, typo.totalPt) + estimateTextWidthMm(subText, typo.totalSubPt)
    total = {
      page: 0,
      xMm: spec.widthMm - OVERLAY_SAFE.topMm - widthMm,
      yMm: OVERLAY_SAFE.topMm,
      mainPt: typo.totalPt,
      subPt: typo.totalSubPt,
      mainText,
      subText,
    }
  } else {
    warnings.push('该卷尚有题目无生效分,未排总分')
  }

  // --- 校准: 缩放 + 平移(试打实测后整体修正) ---
  if (calib.dxMm !== 0 || calib.dyMm !== 0 || scale !== 1) {
    for (const p of pages) {
      for (const m of p.marks) {
        m.xMm = m.xMm * scale + calib.dxMm
        m.yMm = m.yMm * scale + calib.dyMm
      }
      for (const n of p.notes) {
        n.xMm = n.xMm * scale + calib.dxMm
        n.yMm = n.yMm * scale + calib.dyMm
      }
    }
    if (total) {
      total.xMm = total.xMm * scale + calib.dxMm
      total.yMm = total.yMm * scale + calib.dyMm
    }
  }

  return { paperId: paper.id, pages, total, warnings }
}

function maxLineWidthMm(lines: string[], pt: number): number {
  return lines.reduce((m, l) => Math.max(m, estimateTextWidthMm(l, pt)), 0)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max))
}
