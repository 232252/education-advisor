// =============================================================
// TaskDetail — 批改任务详情(右侧面板)
// 元信息 + 状态操作 + 量规编辑(draft/ready 可编辑,之后只读) + 试卷表。
// P3 接「开始 AI 批改」、P4 接「复核/发布」入口。
// =============================================================

import type { EAAStudent, GradingTask, RubricQuestion } from '@shared/types'
import { useEffect, useState } from 'react'
import { useT } from '../../../i18n'
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
}: TaskDetailProps) {
  const { t } = useT()
  const [rubricDraft, setRubricDraft] = useState<RubricQuestion[]>(task.rubric)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 保存量规后服务端返回新 rubric 时同步草稿;切任务由父组件 key 重挂载兜底
  useEffect(() => {
    setRubricDraft(task.rubric)
  }, [task.rubric])

  const rubricEditable = task.status === 'draft' || task.status === 'ready'
  const rubricDirty = JSON.stringify(rubricDraft) !== JSON.stringify(task.rubric)

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
