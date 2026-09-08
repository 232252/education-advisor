// =============================================================
// PapersTable — 试卷列表: 导入(多选文件) / 归属建议与指派 / 移除
// 每个选中文件成为一份试卷;文件名含学生姓名时给出归属建议
// (matchPaperFilesToStudents,唯一命中才建议,歧义留给人工)。
// =============================================================

import { matchPaperFilesToStudents } from '@shared/grading-helpers'
import type { EAAStudent, GradingTask } from '@shared/types'
import { useMemo, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { pickFiles } from '../../../lib/dialog'
import { btnStyle, INPUT_BASE } from '../../../lib/ui-utils'

interface PapersTableProps {
  task: GradingTask
  students: EAAStudent[]
  busy: boolean
  onImport: (taskId: string, batches: Array<{ files: Array<{ path: string }> }>) => Promise<boolean>
  onAssign: (taskId: string, paperId: string, studentName: string | null) => Promise<boolean>
  onRemove: (taskId: string, paperId: string) => Promise<boolean>
}

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]

/** 试卷状态 → i18n 键(显式枚举,i18n 静态收集可识别,不用模板动态键) */
const PAPER_STATUS_KEYS = {
  unassigned: 'page.grading.statusPaper.unassigned',
  pending: 'page.grading.statusPaper.pending',
  graded: 'page.grading.statusPaper.graded',
  failed: 'page.grading.statusPaper.failed',
} as const

export function PapersTable({
  task,
  students,
  busy,
  onImport,
  onAssign,
  onRemove,
}: PapersTableProps) {
  const { t } = useT()
  const [importing, setImporting] = useState(false)

  const activeStudents = useMemo(() => students.filter((s) => s.status === 'Active'), [students])

  // 归属建议(文件名 → 学生);已指派的不再建议
  const suggestions = useMemo(() => {
    const unassigned = task.papers.filter((p) => p.studentName === null)
    return new Map(
      matchPaperFilesToStudents(
        unassigned.map((p) => ({ paperId: p.id, fileName: p.files[0]?.name ?? p.id })),
        activeStudents.map((s) => ({ name: s.name })),
      )
        .filter((m) => m.suggested)
        .map((m) => [m.paperId, m.suggested as string]),
    )
  }, [task.papers, activeStudents])

  const suggestionCount = suggestions.size
  const importable = task.status === 'draft' || task.status === 'ready'

  const handleImport = async () => {
    const paths = await pickFiles({ filters: IMAGE_FILTERS, properties: ['openFile'] })
    if (paths.length === 0) return
    setImporting(true)
    await onImport(
      task.id,
      paths.map((p) => ({ files: [{ path: p }] })),
    )
    setImporting(false)
  }

  const applyAllSuggestions = async () => {
    for (const [paperId, name] of suggestions) {
      // 顺序执行: 服务端按任务串行,前端也不并发轰炸
      const ok = await onAssign(task.id, paperId, name)
      if (!ok) break
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleImport}
          disabled={!importable || busy || importing}
          className={btnStyle('primary')}
        >
          {importing ? t('page.grading.papers.importing') : t('page.grading.papers.import')}
        </button>
        {suggestionCount > 0 && (
          <button
            type="button"
            onClick={applyAllSuggestions}
            disabled={busy || importing}
            className={btnStyle('secondary')}
            title={t('page.grading.papers.applyAllTitle')}
          >
            {tr('page.grading.papers.applyAll', { n: suggestionCount })}
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {tr('page.grading.count.papers', { n: task.papers.length })}
        </span>
      </div>

      {task.papers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-white/10">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('page.grading.papers.empty')}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t('page.grading.papers.emptyDesc')}
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
              <th className="py-1.5 pr-2 font-medium">{t('page.grading.papers.file')}</th>
              <th className="py-1.5 pr-2 font-medium">{t('page.grading.papers.student')}</th>
              <th className="py-1.5 pr-2 font-medium">{t('page.grading.papers.status')}</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {task.papers.map((paper) => {
              const suggested = suggestions.get(paper.id)
              return (
                <tr
                  key={paper.id}
                  className="border-b border-gray-100 last:border-0 dark:border-white/[0.06]"
                >
                  <td
                    className="max-w-[16rem] truncate py-1.5 pr-2"
                    title={paper.files.map((f) => f.name).join(', ')}
                  >
                    {paper.files.map((f) => f.name).join(', ')}
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={paper.studentName ?? ''}
                      disabled={busy}
                      onChange={(e) => void onAssign(task.id, paper.id, e.target.value || null)}
                      className={INPUT_BASE}
                      aria-label={t('page.grading.papers.assignTo')}
                    >
                      <option value="">{t('page.grading.papers.unassigned')}</option>
                      {activeStudents.map((s) => (
                        <option key={s.entity_id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2 text-xs">
                    {paper.studentName === null ? (
                      suggested ? (
                        <button
                          type="button"
                          onClick={() => void onAssign(task.id, paper.id, suggested)}
                          disabled={busy}
                          className="text-blue-500 hover:underline"
                        >
                          {tr('page.grading.papers.suggested', { name: suggested })}
                        </button>
                      ) : (
                        <span className="text-gray-400">{t('page.grading.papers.unassigned')}</span>
                      )
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        {t(PAPER_STATUS_KEYS[paper.status])}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {importable && (
                      <button
                        type="button"
                        onClick={() => void onRemove(task.id, paper.id)}
                        disabled={busy}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        {t('page.grading.papers.remove')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
