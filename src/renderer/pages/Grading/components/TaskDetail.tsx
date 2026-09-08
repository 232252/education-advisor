// =============================================================
// TaskDetail — 批改任务详情(右侧面板)
// 元信息 + 状态操作 + 量规编辑(draft/ready 可编辑,之后只读) + 试卷表
// + AI 批改启动/中止/重试失败 与实时进度(订阅 grading:progress)。
// P4 接「复核/发布」入口。
// =============================================================

import type { EAAStudent, GradingProgressEvent, GradingTask, RubricQuestion } from '@shared/types'
import { useEffect, useState } from 'react'
import { useIpcSubscription } from '../../../hooks/useIpcSubscription'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn } from '../../../lib/ui-utils'
import { PapersTable } from './PapersTable'
import { RubricEditor } from './RubricEditor'

/** 任务状态 → 徽章 i18n 键(显式枚举,不用模板动态键) */
const TASK_STATUS_KEYS = {
  draft: 'page.grading.status.draft',
  ready: 'page.grading.status.ready',
  grading: 'page.grading.status.grading',
  review: 'page.grading.status.review',
  published: 'page.grading.status.published',
} as const

const STATUS_BADGE_CLS: Record<GradingTask['status'], string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  ready: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  grading: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  review: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
  published: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-300',
}

interface TaskDetailProps {
  task: GradingTask
  students: EAAStudent[]
  subjectNameById: Map<string, string>
  busy: boolean
  onClose: () => void
  onUpdateTask: (taskId: string, patch: Record<string, unknown>) => Promise<boolean>
  onDeleteTask: (taskId: string) => Promise<boolean>
  onSetStatus: (taskId: string, status: GradingTask['status']) => Promise<boolean>
  onImportPapers: (
    taskId: string,
    batches: Array<{ files: Array<{ path: string }> }>,
  ) => Promise<boolean>
  onAssignPaper: (taskId: string, paperId: string, studentName: string | null) => Promise<boolean>
  onRemovePaper: (taskId: string, paperId: string) => Promise<boolean>
  onRunGrading: (taskId: string) => Promise<boolean>
  onAbortGrading: (taskId: string) => Promise<boolean>
  onRefresh: () => Promise<void>
}

export function TaskDetail({
  task,
  students,
  subjectNameById,
  busy,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onSetStatus,
  onImportPapers,
  onAssignPaper,
  onRemovePaper,
  onRunGrading,
  onAbortGrading,
  onRefresh,
}: TaskDetailProps) {
  const { t } = useT()
  const [rubricDraft, setRubricDraft] = useState<RubricQuestion[]>(task.rubric)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [progress, setProgress] = useState<GradingProgressEvent | null>(null)

  // 批改进度订阅: 只关心当前任务;done 后刷新任务列表与详情
  useIpcSubscription<GradingProgressEvent>(
    (cb) => getAPI().grading.onProgress(cb),
    (e) => {
      if (e.taskId !== task.id) return
      setProgress(e)
      if (e.phase === 'done') void onRefresh()
    },
  )

  // 保存量规后服务端返回新 rubric 时同步草稿;切任务由父组件 key 重挂载兜底
  useEffect(() => {
    setRubricDraft(task.rubric)
  }, [task.rubric])

  const rubricEditable = task.status === 'draft' || task.status === 'ready'
  const rubricDirty = JSON.stringify(rubricDraft) !== JSON.stringify(task.rubric)

  const failedCount = task.papers.filter((p) => p.status === 'failed').length
  const pendingCount = task.papers.filter(
    (p) => p.studentName !== null && p.status === 'pending',
  ).length
  const canRun =
    (task.status === 'ready' || (task.status === 'review' && failedCount > 0)) &&
    pendingCount + failedCount > 0
  const running = task.status === 'grading'

  const saveRubric = async () => {
    const cleaned = rubricDraft
      .filter((q) => q.title.trim().length > 0 && q.fullMark > 0)
      .map((q, i) => ({ ...q, order: i + 1 }))
    await onUpdateTask(task.id, { rubric: cleaned })
  }

  const metaChip = (label: string, value?: string) =>
    value ? (
      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
        {label}: {value}
      </span>
    ) : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部: 名称 + 状态徽章 + 操作 */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={onClose}
          className={cn(btnStyle('ghost'), '!px-2')}
          aria-label={t('page.grading.detail.back')}
        >
          ←
        </button>
        <h2 className="flex-1 truncate text-sm font-semibold">{task.name}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLS[task.status]}`}
        >
          {t(TASK_STATUS_KEYS[task.status])}
        </span>
        {task.status === 'draft' && task.papers.length > 0 && (
          <button
            type="button"
            onClick={() => void onSetStatus(task.id, 'ready')}
            disabled={busy}
            className={btnStyle('primary')}
          >
            {t('page.grading.detail.markReady')}
          </button>
        )}
        {task.status === 'ready' && (
          <button
            type="button"
            onClick={() => void onSetStatus(task.id, 'draft')}
            disabled={busy}
            className={btnStyle('secondary')}
          >
            {t('page.grading.detail.backToDraft')}
          </button>
        )}
        {canRun && (
          <button
            type="button"
            onClick={() => void onRunGrading(task.id)}
            disabled={busy}
            className={btnStyle('primary')}
          >
            {task.status === 'review'
              ? t('page.grading.run.retryFailed')
              : t('page.grading.run.start')}
          </button>
        )}
        {running && (
          <button
            type="button"
            onClick={() => void onAbortGrading(task.id)}
            disabled={busy}
            className={btnStyle('danger')}
          >
            {t('page.grading.run.abort')}
          </button>
        )}
        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                const ok = await onDeleteTask(task.id)
                if (ok) onClose()
              }}
              disabled={busy}
              className={btnStyle('danger')}
            >
              {t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={btnStyle('ghost')}
            >
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className={cn(btnStyle('ghost'), 'text-red-500')}
          >
            {t('page.grading.detail.delete')}
          </button>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* 元信息 */}
        <div className="flex flex-wrap gap-1.5">
          {metaChip(t('page.grading.task.semester'), task.semester)}
          {metaChip(t('page.grading.task.date'), task.examDate)}
          {metaChip(t('page.grading.task.class'), task.className)}
          {metaChip(
            t('page.grading.task.subject'),
            task.subjectId ? subjectNameById.get(task.subjectId) : undefined,
          )}
        </div>

        {/* 批改进度(running 时实时;done 后保留汇总直到刷新) */}
        {progress && progress.taskId === task.id && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-500/20 dark:bg-amber-500/10">
            {progress.phase === 'done' ? (
              <span className="text-amber-700 dark:text-amber-300">
                {tr('page.grading.progress.done', {
                  graded: progress.gradedCount ?? 0,
                  failed: progress.failedCount ?? 0,
                })}
              </span>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-amber-700 dark:text-amber-300">
                  <span>
                    {progress.phase === 'failed'
                      ? tr('page.grading.progress.failedAt', {
                          student: progress.studentName ?? '',
                          index: progress.index ?? 0,
                          total: progress.total ?? 0,
                        })
                      : tr('page.grading.progress.doing', {
                          student: progress.studentName ?? '',
                          index: progress.index ?? 0,
                          total: progress.total ?? 0,
                        })}
                  </span>
                  <span className="font-mono">
                    {(progress.index ?? 0) / (progress.total ?? 1) > 0
                      ? Math.round(((progress.index ?? 0) / (progress.total ?? 1)) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-500/20">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((progress.index ?? 0) / (progress.total ?? 1)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 量规 */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {t('page.grading.rubric.title')}
            </h3>
            {rubricEditable && rubricDirty && (
              <button
                type="button"
                onClick={() => void saveRubric()}
                disabled={busy}
                className={btnStyle('primary')}
              >
                {t('page.grading.rubric.save')}
              </button>
            )}
          </div>
          {rubricEditable ? (
            <RubricEditor value={rubricDraft} onChange={setRubricDraft} />
          ) : (
            <ul className="space-y-1">
              {task.rubric.length === 0 && (
                <li className="text-xs text-gray-400">{t('page.grading.rubric.empty')}</li>
              )}
              {task.rubric.map((q, i) => (
                <li
                  key={q.id}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-white/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {i + 1}. {q.title}
                    </span>
                    <span className="text-xs text-gray-500">
                      {q.fullMark} {t('page.grading.rubric.points')}
                    </span>
                  </div>
                  {q.referenceAnswer && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400">
                      {q.referenceAnswer}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 试卷 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            {t('page.grading.papers.title')}
          </h3>
          <PapersTable
            task={task}
            students={students}
            busy={busy}
            onImport={onImportPapers}
            onAssign={onAssignPaper}
            onRemove={onRemovePaper}
          />
        </section>
      </div>
    </div>
  )
}
