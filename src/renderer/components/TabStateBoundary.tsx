// =============================================================
// TabStateBoundary — Tab 内容的 loading/error 边界
// (Students/AcademicsTab 与 Academics/OverviewTab 此前逐段同构的
//  三态编排收敛;空态因各页语义差异大,留在调用方 children 内判定)
// =============================================================

import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { CardSkeleton } from './Skeleton'

interface TabStateBoundaryProps {
  loading: boolean
  /** 错误信息(数组会以「;」拼接,适配多源加载);null/undefined/空 = 无错 */
  error: string | string[] | null | undefined
  /** 错误标题文案 */
  errorTitle: string
  /** 错误提示后缀(含前导分隔符,与错误信息拼接显示) */
  errorHint: string
  /** 重试回调(提供才显示重试按钮) */
  onRetry?: () => void
  /** 骨架屏数量(默认 2) */
  skeletonCount?: number
  /** 骨架屏容器类(默认 space-y-4) */
  skeletonClassName?: string
  children: ReactNode
}

export function TabStateBoundary({
  loading,
  error,
  errorTitle,
  errorHint,
  onRetry,
  skeletonCount = 2,
  skeletonClassName = 'space-y-4',
  children,
}: TabStateBoundaryProps) {
  if (loading) {
    return (
      <div className={skeletonClassName}>
        {Array.from({ length: skeletonCount }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架占位，数量固定无重排，索引即稳定键
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }
  const errText = Array.isArray(error) ? error.join(';') : error
  if (errText) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title={errorTitle}
        description={`${errText}${errorHint}`}
        action={
          onRetry ? (
            <Button onClick={onRetry} icon={<RotateCw size={14} aria-hidden />}>
              {t('common.retry', '重试')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  return children
}
