// =============================================================
// overlay-spec-suggestion — 套打纸张规格建议纯函数
// 从 OverlayPrintDocument 的 suggestedSpecId useMemo 中抽出:
// 取第一张量出尺寸的页面图,按宽高比匹配纸张规格;无任何测量
// 或匹配不上(如横拍照片)时回落 A4。抽出的动机与
// overlay-save-decision 相同: 让 1079 行组件的决策逻辑可单测。
// =============================================================

import { DEFAULT_PAPER_SPEC_ID, matchPaperSpec } from '@shared/grading-geometry'

export interface PageImageSize {
  width: number
  height: number
}

/** 页面尺寸表形态与组件的 SizeMap 一致(页下标对齐,测量前 undefined) */
export type PageSizeMap = Record<string, Array<PageImageSize | undefined>>

export function suggestPaperSpecId(sizes: PageSizeMap): string {
  const first = Object.values(sizes)
    .flat()
    .find((s): s is PageImageSize => !!s)
  return first
    ? (matchPaperSpec(first.width, first.height)?.spec.id ?? DEFAULT_PAPER_SPEC_ID)
    : DEFAULT_PAPER_SPEC_ID
}
