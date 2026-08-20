// =============================================================
// 导入下拉菜单 — JSON 导入 / Excel 导入 / Excel 模板下载
// 与 ExportMenu 同款 click-outside 关闭模式（M30 扩展）
// =============================================================

import { FileSpreadsheet, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'

interface ImportMenuProps {
  /** 导入 JSON（原有 Rust 端 serde_json 导入） */
  onImportJson: () => void
  /** 导入 Excel（解析 → 预览确认 → 逐条 add-student） */
  onImportExcel: () => void
  /** 下载 Excel 导入模板 */
  onDownloadTemplate: () => void
}

export function ImportMenu({ onImportJson, onImportExcel, onDownloadTemplate }: ImportMenuProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭导入下拉菜单
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

  const items = [
    { key: 'json', label: t('page.students.import.json', '导入 JSON'), action: onImportJson },
    { key: 'excel', label: t('page.students.import.excel', '导入 Excel'), action: onImportExcel },
    {
      key: 'template',
      label: t('page.students.import.excel.template', '下载 Excel 模板'),
      action: onDownloadTemplate,
    },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="secondary"
        onClick={() => setOpen(!open)}
        icon={<Upload size={14} />}
        aria-label={t('page.students.import.aria', '导入')}
      >
        {t('page.students.import', '导入')}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-surface-tertiary border border-gray-200 dark:border-white/[0.06] rounded-lg shadow-lg z-50 min-w-[160px] animate-scale-in overflow-hidden">
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => {
                setOpen(false)
                item.action()
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors first:rounded-t-lg last:rounded-b-lg"
            >
              <FileSpreadsheet size={14} className="text-gray-400 shrink-0" aria-hidden />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
