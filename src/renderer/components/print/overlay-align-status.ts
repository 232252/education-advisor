// =============================================================
// overlay-align-status — 套打对齐状态推导纯函数
// 从 OverlayPrintDocument 抽出的第四块决策:
//   isTemplateActive       母版模板是否已激活(有框且有任一四角)
//   needsManualQuadAlign   试卷是否需要手动对齐四角
//   deriveAlignStatus      单卷状态: aligned / approx / manual
// 优先级: 模板激活 → 全对齐;缺任一页四角 → manual;
// 四角齐全但有近似页 → approx;否则 aligned。
// =============================================================

import type { PageQuad } from '@shared/grading-geometry'

/** 母版模板的最小结构形状(避免整份 GradingTask 类型耦合) */
export interface OverlayTemplateLike {
  boxes?: Record<string, unknown>
  quads?: Array<PageQuad | null>
}

export interface PaperAlignLike {
  files: unknown[]
  overlayQuads?: Array<PageQuad | null>
}

export type AlignStatus = 'aligned' | 'approx' | 'manual'

/** 母版模板激活 = 有定位框 且 至少一个四角已定 */
export function isTemplateActive(tpl: OverlayTemplateLike | undefined | null): boolean {
  return !!tpl?.boxes && Object.keys(tpl.boxes).length > 0 && !!tpl.quads?.some((q) => q != null)
}

/** 有扫描页但任一页四角缺失 → 需手动对齐 */
export function needsManualQuadAlign(paper: PaperAlignLike): boolean {
  return (
    paper.files.length > 0 && (!paper.overlayQuads || paper.overlayQuads.some((q) => q == null))
  )
}

/** 单卷状态推导(approxPages 来自 layoutOverlayPaper 的近似页计数) */
export function deriveAlignStatus(input: {
  templateActive: boolean
  paper: PaperAlignLike
  approxPages: number
}): AlignStatus {
  if (input.templateActive) return 'aligned'
  if (needsManualQuadAlign(input.paper)) return 'manual'
  if (input.approxPages > 0) return 'approx'
  return 'aligned'
}

/** 任一试卷已有四角记录(说明对齐流程已被触发过,自动检测不应再抢跑) */
export function anyQuadAttempted(papers: Array<PaperAlignLike>): boolean {
  return papers.some((p) => (p.overlayQuads?.length ?? 0) > 0)
}

/**
 * 首次自动四角检测的触发判定(防呆):
 *   本次会话未自动跑过 && 全任务从未有过四角记录 && 当前确有待对齐试卷。
 * 已有四角记录说明用户(或此前会话)已经动过对齐流程,自动检测
 * 再抢跑会覆盖已有工作,必须让位。
 */
export function shouldAutoDetect(input: {
  alreadyAutoDetected: boolean
  anyQuadAttempted: boolean
  needManualCount: number
}): boolean {
  return !input.alreadyAutoDetected && !input.anyQuadAttempted && input.needManualCount > 0
}
