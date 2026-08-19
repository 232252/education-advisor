// =============================================================
// PrintOverlay — 打印/PDF 预览覆盖层
// 通过 React Portal 渲染到 body 直下(.print-portal),配合
// globals.css 的 @media print 规则: 打印时只输出报告文档。
// 屏幕上显示 A4 纸张预览 + 工具栏(打印/关闭)。
// 打印对话框中选择"另存为 PDF"即可导出 PDF 文件。
// =============================================================

import { FileText, Printer, X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'

interface PrintOverlayProps {
  /** 屏幕预览标题(工具栏显示) */
  title: string
  /** 关闭回调 */
  onClose: () => void
  /** 报告文档(打印本体) */
  children: ReactNode
}

export function PrintOverlay({ title, onClose, children }: PrintOverlayProps) {
  const { t } = useT()

  // Esc 关闭 + 打开期间锁定背景滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="print-portal fixed inset-0 z-[80] bg-gray-900/50 backdrop-blur-sm overflow-y-auto">
      {/* 工具栏 — 仅屏幕预览可见,打印时隐藏 */}
      <div className="print-toolbar sticky top-0 z-10 flex items-center gap-3 px-4 h-12 bg-gray-800 text-white">
        <FileText size={15} className="opacity-80" />
        <span className="text-sm font-medium truncate">{title}</span>
        <span className="hidden sm:inline text-xs text-gray-400 truncate">
          {t('print.hint.pdf', '打印对话框中选择「另存为 PDF」可导出 PDF 文件')}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <Printer size={13} />
            {t('print.action', '打印 / 导出 PDF')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* A4 纸张预览(210mm 宽) — 打印时由 .print-root 规则还原为全宽 */}
      <div className="print-root w-[210mm] max-w-full min-h-[297mm] mx-auto my-6 bg-white text-gray-900 shadow-2xl rounded-sm px-10 py-8">
        {children}
      </div>
    </div>,
    document.body,
  )
}
