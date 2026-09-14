// =============================================================
// PaperScanPages — 试卷扫描件 + 卷面批注(红笔痕迹版)
// 复核台(屏幕)与打印(批阅报告/痕迹卷)共用同一套痕迹,避免两处漂移。
// 版式原则(2026-09-14 手写化重做):
//   卷面只落红笔短痕: 全对✓ / 零分✗ / 部分对得分,手写体细红字,
//   贴作答区右上角外,永不压学生字迹;
//   评语全文放页边批注栏,按题目纵向位置对齐(不按题序硬排)。
//   红框仅屏幕复核用(给教师定位),打印/导出一律不画。
// =============================================================

import type { PaperMarkOverlay } from '@shared/grading-helpers'
import type { CSSProperties } from 'react'
import { cn } from '../../lib/ui-utils'

interface PaperScanPagesProps {
  imageUrls: string[]
  overlays: PaperMarkOverlay[]
  emptyLabel?: string
  /** print: 打印版式; screen: 复核台样式 */
  variant?: 'screen' | 'print'
  /** 痕迹卷版式: 无边框无页签,卷面略缩(84%)给红笔边栏留位 */
  paper?: boolean
  pageCaption?: (pageIdx: number) => string
}

/** 红笔短痕放在作答框右上角外侧;框太靠右则换到左上角外侧,始终不出卷面 */
function markStyle(m: PaperMarkOverlay): CSSProperties {
  if (m.x + m.w <= 0.9) {
    return {
      left: `${(m.x + m.w) * 100}%`,
      top: `${m.y * 100}%`,
      transform: 'translate(6%, -60%)',
    }
  }
  return {
    left: `${m.x * 100}%`,
    top: `${m.y * 100}%`,
    transform: 'translate(calc(-100% - 6%), -60%)',
  }
}

/**
 * 页边批注纵向布局: 期望位置 = 作答区纵中心;按 y 排序后自上而下
 * 防重叠(每条按字数预留高度槽),并钳制在栏内。返回相对栏高的 top 百分比。
 */
export function layoutMarginNotes(
  marks: PaperMarkOverlay[],
): Array<{ mark: PaperMarkOverlay; top: number }> {
  const desired = marks
    .filter((m) => m.note.length > 0)
    .map((m) => ({ m, at: Math.min(Math.max((m.y + m.h / 2) * 100, 2), 96) }))
    .sort((a, b) => a.at - b.at)
  const out: Array<{ mark: PaperMarkOverlay; top: number }> = []
  let prevBottom = 0
  for (const { m, at } of desired) {
    // 预留高度槽: 基础 6% + 每 40 字加 5%(窄栏约 9 字/行的近似),封顶 22%
    const slot = Math.min(6 + Math.ceil(m.note.length / 40) * 5, 22)
    const top = Math.min(Math.max(at - slot / 2, prevBottom), 100 - slot)
    out.push({ mark: m, top })
    prevBottom = top + slot
  }
  return out
}

export function PaperScanPages({
  imageUrls,
  overlays,
  emptyLabel,
  variant = 'screen',
  paper = false,
  pageCaption,
}: PaperScanPagesProps) {
  if (imageUrls.length === 0) {
    return emptyLabel ? (
      <p
        className={
          variant === 'print'
            ? 'py-6 text-center text-xs text-gray-500'
            : 'pt-8 text-center text-xs text-gray-400'
        }
      >
        {emptyLabel}
      </p>
    ) : null
  }

  return (
    <>
      {imageUrls.map((url, pageIdx) => {
        const marks = overlays.filter((o) => o.page === pageIdx)
        const notes = layoutMarginNotes(marks)
        return (
          <div key={url} className={variant === 'print' && !paper ? 'mt-3' : ''}>
            {pageCaption && !paper && (
              <p className="mb-1 text-[10px] text-gray-500">{pageCaption(pageIdx)}</p>
            )}
            <div
              className={cn(
                'flex items-stretch gap-2',
                variant === 'print' ? (paper ? 'marked-paper-page' : 'grading-marks-scan') : '',
              )}
            >
              {/* 卷面: 红笔短痕贴作答区角外;红框仅屏幕复核显示 */}
              <div
                className={cn(
                  'relative overflow-hidden',
                  paper ? 'w-[84%] shrink-0' : 'flex-1',
                  !paper &&
                    (variant === 'print'
                      ? 'border border-gray-300'
                      : 'mb-3 rounded-lg border border-gray-200 shadow-sm dark:border-white/10'),
                )}
              >
                <img src={url} alt={`paper-scan-${pageIdx + 1}`} className="block w-full" />
                {marks.map((m, i) => (
                  <div key={m.questionId}>
                    {variant === 'screen' && (
                      <div
                        className="pointer-events-none absolute border border-red-500/80 dark:border-red-400/80"
                        style={{
                          left: `${m.x * 100}%`,
                          top: `${m.y * 100}%`,
                          width: `${m.w * 100}%`,
                          height: `${m.h * 100}%`,
                        }}
                      />
                    )}
                    <div
                      className={cn(
                        'handwriting-mark pointer-events-none absolute z-10 whitespace-nowrap leading-tight text-red-700 dark:text-red-300',
                        m.verdict === 'partial' ? 'text-[11px]' : 'text-[13px]',
                      )}
                      style={markStyle(m)}
                    >
                      {/* 屏幕复核: 序号角标(与页边批注对应) + 红笔短痕;打印: 只留短痕 */}
                      {variant === 'screen' && (
                        <span className="mr-0.5 rounded bg-red-600 px-1 py-px font-sans text-[10px] font-semibold text-white shadow-sm">
                          {i + 1}
                        </span>
                      )}
                      {m.mark}
                    </div>
                  </div>
                ))}
              </div>
              {/* 页边批注栏: 手写体红字,按题目纵向位置对齐,不占卷面 */}
              {notes.length > 0 && (
                <div
                  className={cn(
                    'relative',
                    paper ? 'flex-1' : 'w-[24%] shrink-0',
                    variant === 'print'
                      ? 'border-l border-red-300 pl-1.5'
                      : 'mb-3 border-l-2 border-red-400 pl-1.5 dark:border-red-500/70',
                  )}
                >
                  {notes.map(({ mark: m, top }) => (
                    <p
                      key={m.questionId}
                      className={cn(
                        'handwriting-mark absolute left-1.5 right-0 whitespace-pre-wrap break-words text-red-800 dark:text-red-200',
                        variant === 'print'
                          ? 'text-[9px] leading-[1.5]'
                          : 'text-[10px] leading-snug',
                      )}
                      style={{ top: `${top}%` }}
                    >
                      {m.note}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
