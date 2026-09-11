// =============================================================
// PaperScanPages — 试卷扫描件 + 卷面批注红框
// 复核台(屏幕)与批阅痕迹打印共用同一套叠字,避免两处漂移。
// =============================================================

import type { PaperMarkOverlay } from '@shared/grading-helpers'
import { cn } from '../../lib/ui-utils'

interface PaperScanPagesProps {
  imageUrls: string[]
  overlays: PaperMarkOverlay[]
  emptyLabel?: string
  /** print: 对比更强、跨页不断开; screen: 复核台样式 */
  variant?: 'screen' | 'print'
  pageCaption?: (pageIdx: number) => string
}

export function PaperScanPages({
  imageUrls,
  overlays,
  emptyLabel,
  variant = 'screen',
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
        return (
          <div key={url} className={variant === 'print' ? 'mt-3' : ''}>
            {pageCaption && (
              <p className="mb-1 text-[10px] text-gray-500">{pageCaption(pageIdx)}</p>
            )}
            <div
              className={cn(
                'relative overflow-hidden',
                variant === 'print'
                  ? 'grading-marks-scan w-full border border-gray-300'
                  : 'mx-auto mb-3 w-full max-w-full rounded-lg border border-gray-200 shadow-sm dark:border-white/10',
              )}
            >
              <img src={url} alt={`paper-scan-${pageIdx + 1}`} className="block w-full" />
              {marks.map((m) => (
                <div
                  key={m.questionId}
                  className={
                    variant === 'print'
                      ? 'pointer-events-none absolute border-2 border-red-600 bg-red-50/90 px-1 py-0.5 text-[10px] leading-tight text-red-800'
                      : 'pointer-events-none absolute border border-red-500/80 bg-red-500/10 px-1 py-0.5 text-[10px] leading-tight text-red-700 dark:text-red-200'
                  }
                  style={{
                    left: `${m.x * 100}%`,
                    top: `${m.y * 100}%`,
                    width: `${Math.max(m.w * 100, 8)}%`,
                    minHeight: `${Math.max(m.h * 100, 4)}%`,
                  }}
                >
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
