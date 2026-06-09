// =============================================================
// ToastContainer — 全局 toast 渲染容器
// 修复 P2-8: 在 App.tsx 顶层挂载,显示所有 toast 通知
// 位置:屏幕右上角,堆叠展示,自动消失
// =============================================================

import { type ToastType, useToastStore } from '../stores/toastStore'
import './ToastContainer.css'

const ICONS: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  error: '✕',
  warning: '⚠',
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <section className="toast-container" aria-label="通知" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}
        >
          <span className="toast-icon" aria-hidden="true">
            {ICONS[t.type]}
          </span>
          <span className="toast-message">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismiss(t.id)}
            aria-label="关闭通知"
          >
            ×
          </button>
        </div>
      ))}
    </section>
  )
}
