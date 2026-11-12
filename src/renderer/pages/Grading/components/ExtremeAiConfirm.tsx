// =============================================================
// 极致 AI 模式:选用确认(消耗大量 token 的明确提示,确认后才生效)
// =============================================================

import type { GradingStrategy } from '@shared/types'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../i18n'

/**
 * 切换到极致 AI 模式前弹出确认;取消则保持原模式,不静默生效。
 */
export function useExtremeStrategyGate(
  current: GradingStrategy,
  apply: (next: GradingStrategy) => void,
): {
  confirmOpen: boolean
  requestChange: (next: GradingStrategy) => void
  onConfirm: () => void
  onCancel: () => void
} {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const requestChange = (next: GradingStrategy) => {
    if (next === 'extreme' && current !== 'extreme') {
      setConfirmOpen(true)
      return
    }
    apply(next)
  }
  return {
    confirmOpen,
    requestChange,
    onConfirm: () => {
      setConfirmOpen(false)
      apply('extreme')
    },
    onCancel: () => setConfirmOpen(false),
  }
}

export function ExtremeAiConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  return (
    <ConfirmDialog
      open={open}
      title={t('page.grading.strategy.extreme.confirmTitle', '启用极致 AI 模式？')}
      message={t(
        'page.grading.strategy.extreme.confirmMessage',
        '极致 AI 模式全程靠视觉自行批改并排版打印 PDF，会派出两个子代理对齐核验，全部通过才给分；不通过则重裁并由一个子代理仲裁。这会消耗大量 token，费用明显高于其他模式。上下文上限 20 万 tokens 并自动压缩。确认后才生效，可随时改回。',
      )}
      confirmText={t('page.grading.strategy.extreme.confirmAction', '确认启用')}
      cancelText={t('common.cancel', '取消')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
