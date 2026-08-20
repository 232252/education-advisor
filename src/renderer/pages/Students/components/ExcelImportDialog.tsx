// =============================================================
// Excel 导入预览对话框（M30）
// parse-excel 预览表格 + 行级问题清单 → 确认后 import-excel
// 进度条复用 class:assign-progress 的推送模式；完成后展示失败清单
// =============================================================

import type {
  StudentImportPreview,
  StudentImportProgress,
  StudentImportResult,
  StudentImportRowError,
} from '@shared/types'
import { useEffect } from 'react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'
import { cn, TABLE_TD, TABLE_TH } from '../../../lib/ui-utils'

interface ExcelImportDialogProps {
  /** 是否显示对话框 */
  open: boolean
  /** parse-excel 返回的预览（含合法行与问题行） */
  preview: StudentImportPreview | null
  /** 是否正在导入（import-excel 进行中） */
  importing: boolean
  /** 主进程推送的导入进度 */
  progress: StudentImportProgress | null
  /** import-excel 结果（非 null 表示已完成，展示失败清单） */
  result: StudentImportResult | null
  /** 确认导入（预览阶段） */
  onConfirm: () => void
  /** 关闭对话框（导入中禁用） */
  onClose: () => void
}

export function ExcelImportDialog({
  open,
  preview,
  importing,
  progress,
  result,
  onConfirm,
  onClose,
}: ExcelImportDialogProps) {
  const { t } = useT()

  // Escape 关闭（导入中不允许）
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, importing, onClose])

  if (!open) return null

  const reasonText = (reason: StudentImportRowError['reason']): string =>
    t(`page.students.import.excel.reason.${reason}`)

  const validRows = preview?.rows ?? []
  const errorRows = preview?.errors ?? []
  const percent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onClose()
      }}
    >
      <div
        className="bg-white dark:bg-surface-elevated rounded-xl shadow-xl border border-gray-200/50 dark:border-white/[0.08] w-[560px] max-w-[90vw] max-h-[85vh] flex flex-col p-5 animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-label={t('page.students.import.excel.previewTitle')}
      >
        {/* 标题 */}
        <h2 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100 shrink-0">
          {result
            ? t('page.students.import.excel.doneTitle')
            : t('page.students.import.excel.previewTitle')}
        </h2>

        {result ? (
          /* ----- 完成阶段：结果摘要 + 失败清单 ----- */
          <div className="min-h-0 flex flex-col gap-3">
            <p
              className={cn(
                'text-sm',
                result.failed.length === 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-amber-600 dark:text-amber-400',
              )}
            >
              {t('page.students.import.excel.doneSummary')
                .replace('{0}', String(result.imported))
                .replace('{1}', String(result.failed.length))}
            </p>
            {result.failed.length > 0 && (
              <div className="min-h-0">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t('page.students.import.excel.failedTitle')}
                </h3>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 overflow-auto max-h-56 pr-1">
                  {result.failed.map((f) => (
                    <li key={`${f.row}-${f.name}`}>
                      {t('page.students.import.excel.colRow')} {f.row}
                      {f.name ? ` · ${f.name}` : ''} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : importing ? (
          /* ----- 导入中：进度条 ----- */
          <div className="py-8 flex flex-col items-center gap-3">
            <p className="text-sm text-blue-600 dark:text-blue-400">
              {t('page.students.import.excel.importing')
                .replace('{0}', String(progress?.current ?? 0))
                .replace('{1}', String(progress?.total ?? validRows.length))}
            </p>
            <div className="w-full h-2 bg-gray-200 dark:bg-white/[0.08] rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-150"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        ) : (
          /* ----- 预览阶段：摘要 + 预览表格 + 问题行 ----- */
          <div className="min-h-0 flex flex-col gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-300 shrink-0">
              {t('page.students.import.excel.summary')
                .replace('{0}', String(preview?.totalRows ?? 0))
                .replace('{1}', String(validRows.length))
                .replace('{2}', String(errorRows.length))}
            </p>
            {validRows.length > 0 && (
              <div className="min-h-0 overflow-auto border border-gray-200 dark:border-white/[0.06] rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-surface-tertiary z-10">
                    <tr>
                      <th className={cn(TABLE_TH, 'w-14')}>
                        {t('page.students.import.excel.colRow')}
                      </th>
                      <th className={TABLE_TH}>{t('page.students.import.excel.colName')}</th>
                      <th className={TABLE_TH}>{t('page.students.import.excel.colStudentId')}</th>
                      <th className={TABLE_TH}>{t('page.students.import.excel.colClass')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((r) => (
                      <tr
                        key={`${r.row}-${r.name}`}
                        className="border-b border-gray-100 dark:border-white/[0.06] last:border-b-0"
                      >
                        <td className={cn(TABLE_TD, 'text-gray-400 text-xs')}>{r.row}</td>
                        <td className={TABLE_TD}>{r.name}</td>
                        <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400 text-xs')}>
                          {r.studentId || '—'}
                        </td>
                        <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400 text-xs')}>
                          {r.className || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {errorRows.length > 0 && (
              <div className="shrink-0">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t('page.students.import.excel.errorRows')}
                </h3>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 overflow-auto max-h-32 pr-1">
                  {errorRows.map((e) => (
                    <li key={`${e.row}-${e.reason}`}>
                      {t('page.students.import.excel.colRow')} {e.row}
                      {e.name ? ` · ${e.name}` : ''} — {reasonText(e.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 mt-4 shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={importing}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button
              size="sm"
              onClick={onConfirm}
              loading={importing}
              disabled={validRows.length === 0}
            >
              {t('page.students.import.excel.confirm').replace('{0}', String(validRows.length))}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
