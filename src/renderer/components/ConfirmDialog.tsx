// =============================================================
// ConfirmDialog — 自定义确认对话框组件
// 替代原生 window.confirm()，提供与应用一致的 UI 体验。
// 支持暗色模式、键盘操作（Enter 确认 / Escape 取消）。
// =============================================================

import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  /** 是否显示对话框 */
  open: boolean
  /** 对话框标题 */
  title?: string
  /** 对话框内容/消息 */
  message: string
  /** 确认按钮文字 */
  confirmText?: string
  /** 取消按钮文字 */
  cancelText?: string
  /** 确认按钮颜色变体：'danger' 为红色，默认为蓝色 */
  variant?: 'default' | 'danger'
  /** 确认回调 */
  onConfirm: () => void
  /** 取消回调 */
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // 键盘事件：Enter 确认，Escape 取消
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    document.addEventListener('keydown', handleKey)
    // 自动聚焦确认按钮
    confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  const confirmBtnClass =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white'

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 max-w-[90vw] p-5"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        {title && (
          <h2
            id="confirm-dialog-title"
            className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100"
          >
            {title}
          </h2>
        )}
        <p
          id="confirm-dialog-message"
          className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed mb-5"
        >
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${confirmBtnClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
