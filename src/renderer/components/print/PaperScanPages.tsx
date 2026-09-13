// =============================================================
// PaperScanPages — 试卷扫描件 + 卷面批注(边栏版)
// 复核台(屏幕)与批阅痕迹打印共用同一套叠字,避免两处漂移。
// 版式原则(2026-09-13 重做): 批注永不压住学生作答 ——
//   卷面只画细红框 + 框外角标(序号·得分);
//   评语/依据全文放页面右侧的页边批注栏,靠序号与角标对应。
// =============================================================

import type { PaperMarkOverlay } from '@shared/grading-helpers'
import type { CSSProperties } from 'react'
import { cn } from '../../lib/ui-utils'

interface PaperScanPagesProps {
  imageUrls: string[]
  overlays: PaperMarkOverlay[]
  emptyLabel?: string
  /** print: 对比更强、跨页不断开; screen: 复核台样式 */
  variant?: 'screen' | 'print'
  pageCaption?: (pageIdx: number) => string
}

/** 角标放在框右上角外侧; 框太靠右则换到左上角外侧,始终不出卷面 */
function badgeStyle(m: PaperMarkOverlay): CSSProperties {
  if (m.x + m.w <= 0.88) {
    return {
      left: `${(m.x + m.w) * 100}%`,
      top: `${m.y * 100}%`,
      transform: 'translate(-35%, -55%)',
    }
  }
  return {
    left: `${m.x * 100}%`,
    top: `${m.y * 100}%`,
    transform: 'translate(-65%, -55%)',
  }
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
            <div className="flex items-start gap-2">
              {/* 卷面: 细框圈出作答区域,角标贴框外角,不压字迹 */}
              <div
                className={cn(
                  'relative flex-1 overflow-hidden',
                  variant === 'print'
                    ? 'border border-gray-300'
                    : 'mb-3 rounded-lg border border-gray-200 shadow-sm dark:border-white/10',
                )}
              >
                <img src={url} alt={`paper-scan-${pageIdx + 1}`} className="block w-full" />
                {marks.map((m, i) => (
                  <div key={m.questionId}>
                    <div
                      className={
                        variant === 'print'
                          ? 'pointer-events-none absolute border-2 border-red-600'
                          : 'pointer-events-none absolute border border-red-500/80 dark:border-red-400/80'
                      }
                      style={{
                        left: `${m.x * 100}%`,
                        top: `${m.y * 100}%`,
                        width: `${m.w * 100}%`,
                        height: `${m.h * 100}%`,
                      }}
                    />
                    <div
                      className={
                        variant === 'print'
                          ? 'pointer-events-none absolute z-10 whitespace-nowrap rounded-sm border border-red-600 bg-white px-1 text-[9px] font-bold leading-tight text-red-700'
                          : 'pointer-events-none absolute z-10 whitespace-nowrap rounded bg-red-600 px-1 py-px text-[10px] font-semibold leading-tight text-white shadow-sm'
                      }
                      style={badgeStyle(m)}
                    >
                      {i + 1}
                      {m.badge ? ` ${m.badge}` : ''}
                    </div>
                  </div>
                ))}
              </div>
              {/* 页边批注栏: 序号对应角标,评语/依据全文在此,不占卷面 */}
              {marks.length > 0 && (
                <div
                  className={cn(
                    'w-[24%] shrink-0 space-y-1.5',
                    variant === 'print'
                      ? 'text-[9px] leading-tight text-red-900'
                      : 'mb-3 text-[10px] leading-snug text-red-700 dark:text-red-200',
                  )}
                >
                  {marks.map((m, i) => (
                    <p
                      key={m.questionId}
                      className="border-l-2 border-red-400 pl-1.5 dark:border-red-500/70"
                    >
                      <span className="font-bold">{i + 1}.</span> {m.note}
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
