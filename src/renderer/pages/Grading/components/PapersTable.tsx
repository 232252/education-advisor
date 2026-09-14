// =============================================================
// PapersTable — 试卷列表: 导入(多选文件,同名多页归组) / 归属建议与指派 / 移除
// 默认按文件名把多页合成一份试卷;「导入为同一份」强制合并当前所选。
// (matchPaperFilesToStudents,唯一命中才建议,歧义留给人工)。
// =============================================================

import {
  effectiveTotalScore,
  groupPaperImportPaths,
  matchPaperFilesToStudents,
  rubricFullMark,
} from '@shared/grading-helpers'
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
  onReview?: (paperId: string) => void
  /** 导出单份批阅痕迹(打印/PDF) */
  onExportMarks?: (paperId: string) => void
  exportMarksLoading?: boolean
  /** 重改单份试卷(重新 AI 批改,覆盖上次结果与复核) */
  onRegrade?: (paperId: string) => Promise<boolean>
  /** 从卷面识别未归组试卷的归属 */
  onIdentify?: () => void
}

const IMAGE_FILTERS = [
  { name: 'Papers', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'pdf', 'zip'] },
]

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
  onReview,
  onExportMarks,
  exportMarksLoading = false,
  onRegrade,
  onIdentify,
}: PapersTableProps) {
  const { t } = useT()
  const [importing, setImporting] = useState(false)
  // 重改两段式确认(覆盖上次 AI 结果与复核,需显式确认;同 TaskDetail.confirmDelete 惯例)
  const [confirmRegradeId, setConfirmRegradeId] = useState<string | null>(null)

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
  const fullMark = rubricFullMark(task.rubric)

  const handleImport = async () => {
    const paths = await pickFiles({ filters: IMAGE_FILTERS, properties: ['openFile'] })
    if (paths.length === 0) return
    setImporting(true)
    await onImport(task.id, groupPaperImportPaths(paths))
    setImporting(false)
  }

  const handleImportMerged = async () => {
    const paths = await pickFiles({ filters: IMAGE_FILTERS, properties: ['openFile'] })
    if (paths.length === 0) return
    setImporting(true)
    await onImport(task.id, [{ files: paths.map((path) => ({ path })) }])
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
          onClick={() => void handleImport()}
          disabled={!importable || busy || importing}
          className={btnStyle('primary')}
        >
          {importing ? t('page.grading.papers.importing') : t('page.grading.papers.import')}
        </button>
        <button
          type="button"
          onClick={() => void handleImportMerged()}
          disabled={!importable || busy || importing}
          className={btnStyle('secondary')}
          title={t('page.grading.papers.importMergedTitle')}
        >
          {t('page.grading.papers.importMerged')}
        </button>
        {onIdentify && (
          <button
            type="button"
            onClick={() => onIdentify()}
            disabled={busy || importing}
            className={btnStyle('secondary')}
            title={t('page.grading.identify.title')}
          >
            {t('page.grading.identify.run')}
          </button>
        )}
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
                    {paper.files.length > 1
                      ? `${paper.files[0]?.name ?? ''} (${tr('page.grading.papers.pages', { n: paper.files.length })})`
                      : (paper.files[0]?.name ?? '')}
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
                    {/* 卷面识别留痕:读到什么显示什么,候选一键归组(没识别成功也不黑盒) */}
                    {paper.studentName === null && paper.identity && (
                      <div className="mt-1 text-[11px] leading-relaxed">
                        <span className="text-gray-500 dark:text-gray-400">
                          {tr('page.grading.papers.readIdentity', {
                            text:
                              [
                                paper.identity.name,
                                paper.identity.number
                                  ? tr('page.grading.papers.identityNumber', {
                                      n: paper.identity.number,
                                    })
                                  : '',
                              ]
                                .filter((s) => s.length > 0)
                                .join('｜') || t('page.grading.papers.identityEmpty'),
                          })}
                        </span>
                        {paper.identity.candidates.length > 0 ? (
                          <span className="ml-1 inline-flex flex-wrap gap-1">
                            {paper.identity.candidates.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => void onAssign(task.id, paper.id, c)}
                                disabled={busy}
                                className="rounded bg-blue-50 px-1.5 py-px text-blue-600 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-500/15 dark:text-blue-300"
                              >
                                {c}
                              </button>
                            ))}
                          </span>
                        ) : (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">
                            {t('page.grading.papers.identityNoMatch')}
                          </span>
                        )}
                      </div>
                    )}
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
                    ) : paper.status === 'graded' && paper.ai ? (
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {effectiveTotalScore(paper) ?? paper.ai.totalScore}/{fullMark}
                      </span>
                    ) : (
                      <span
                        className={
                          paper.status === 'failed'
                            ? 'text-red-500'
                            : 'text-gray-500 dark:text-gray-400'
                        }
                        title={paper.status === 'failed' ? paper.error : undefined}
                      >
                        {t(PAPER_STATUS_KEYS[paper.status])}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {onReview && paper.ai && (
                      <button
                        type="button"
                        onClick={() => onReview(paper.id)}
                        className="mr-2 text-xs text-blue-500 hover:underline"
                      >
                        {t('page.grading.review.open')}
                      </button>
                    )}
                    {onExportMarks && paper.ai && (
                      <button
                        type="button"
                        onClick={() => onExportMarks(paper.id)}
                        disabled={exportMarksLoading}
                        className="mr-2 text-xs text-blue-500 hover:underline disabled:opacity-50"
                      >
                        {t('page.grading.exportMarksOne', '导出痕迹')}
                      </button>
                    )}
                    {onRegrade && paper.ai && (
                      <span className="mr-2 inline-flex items-center gap-1">
                        {confirmRegradeId === paper.id ? (
                          <>
                            <span className="text-xs text-amber-600 dark:text-amber-300">
                              {t('page.grading.regrade.confirm')}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmRegradeId(null)
                                void onRegrade(paper.id)
                              }}
                              disabled={busy}
                              className="text-xs font-medium text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-300"
                            >
                              {t('common.confirm')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRegradeId(null)}
                              className="text-xs text-gray-400 hover:underline"
                            >
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRegradeId(paper.id)}
                            disabled={busy}
                            title={t('page.grading.regrade.title')}
                            className="text-xs text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-300"
                          >
                            {t('page.grading.regrade.action')}
                          </button>
                        )}
                      </span>
                    )}
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
