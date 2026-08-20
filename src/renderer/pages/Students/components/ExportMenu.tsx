// =============================================================
// 导出格式下拉菜单 — 从 StudentsPage 提取
// 内部自带 click-outside 关闭逻辑
// =============================================================

import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'

interface ExportMenuProps {
  /** 支持的导出格式列表（从 EAA 动态获取） */
  formats: string[]
  /** 选择格式后触发导出 */
  onExport: (format: string) => void
}

export function ExportMenu({ formats, onExport }: ExportMenuProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭导出下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="secondary"
        onClick={() => setOpen(!open)}
        icon={<Download size={14} />}
        aria-label={t('page.students.export', '导出')}
      >
        {t('page.students.export', '导出')}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-surface-tertiary border border-gray-200 dark:border-white/[0.06] rounded-lg shadow-lg z-50 min-w-[120px] animate-scale-in overflow-hidden">
          {formats.map((fmt) => (
            <button
              type="button"
              key={fmt}
              onClick={() => {
                setOpen(false)
                onExport(fmt)
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors first:rounded-t-lg last:rounded-b-lg"
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
