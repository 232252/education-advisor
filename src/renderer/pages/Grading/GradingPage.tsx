// =============================================================
// 批改作业页面 — 内置 AI 批改子系统入口(侧边栏一级页)
// 布局同 Classes: 左任务列表 + 右任务详情。
// 流程: 新建任务(量规) → 导入试卷并归组 → 标记就绪 →
//       (P3)AI 批改 → (P4)复核 → 发布进学业分析。
// =============================================================

import type { AcademicConfig, GradingTask } from '@shared/types'
import { ClipboardCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { TableSkeleton } from '../../components/Skeleton'
import { tr, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle } from '../../lib/ui-utils'
import { useClassStore } from '../../stores/class/store'
import { useStudentStore } from '../../stores/student/store'
import { TaskCreateDialog } from './components/TaskCreateDialog'
import { TaskDetail } from './components/TaskDetail'
import { useGradingData } from './hooks/useGradingData'

/** 任务状态徽章文案键(与 TaskDetail 共用口径,显式枚举) */
const STATUS_KEYS = {
  draft: 'page.grading.status.draft',
  ready: 'page.grading.status.ready',
  grading: 'page.grading.status.grading',
  review: 'page.grading.status.review',
  published: 'page.grading.status.published',
} as const

const STATUS_CLS: Record<GradingTask['status'], string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  ready: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  grading: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  review: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
  published: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-300',
}

export function GradingPage() {
  const { t } = useT()
  const grading = useGradingData()
  const [createOpen, setCreateOpen] = useState(false)
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig | null>(null)

  const rawStudents = useStudentStore((s) => s.items)
  const students = useMemo(() => rawStudents.filter((s) => s.status !== 'Deleted'), [rawStudents])
  const classList = useClassStore((s) => s.items)
  // 共享 store 惰性拉取(TTL 内不重复 spawn)
  useEffect(() => {
    void useStudentStore.getState().fetchItems()
    void useClassStore.getState().fetchItems()
  }, [])

  useEffect(() => {
    void (async () => {
      const r = await getAPI().academic.getConfig()
      if (r.success && r.data) setAcademicConfig(r.data)
    })()
  }, [])

  const subjectOptions = useMemo(
    () => (academicConfig?.subjects ?? []).map((s) => ({ id: s.id, name: s.name })),
    [academicConfig],
  )
  const subjectNameById = useMemo(
    () => new Map(subjectOptions.map((s) => [s.id, s.name])),
    [subjectOptions],
  )
  const classOptions = useMemo(
    () => classList.filter((c) => !c.archived).map((c) => c.name),
    [classList],
  )

  const selectedId = grading.detail?.id ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={t('page.grading.title')}
        subtitle={t('page.grading.subtitle')}
        actions={
          <>
            <button
              type="button"
              onClick={() => void grading.loadTasks()}
              aria-label={t('common.refresh')}
              className={btnStyle('ghost')}
            >
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              aria-label={t('page.grading.add')}
              className={btnStyle('primary')}
            >
              + {t('page.grading.add')}
            </button>
          </>
        }
      />

      {/* 反馈条 */}
      {grading.errorMsg && (
        <div className="flex-shrink-0 flex items-center justify-between bg-red-50 px-6 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
          <span className="truncate">{grading.errorMsg}</span>
          <button
            type="button"
            onClick={grading.clearFeedback}
            className="ml-2 shrink-0 hover:underline"
          >
            {t('common.close')}
          </button>
        </div>
      )}
      {grading.notice && (
        <div className="flex-shrink-0 bg-green-50 px-6 py-1.5 text-xs text-green-600 dark:bg-green-900/20 dark:text-green-400">
          {grading.notice}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左: 任务列表 */}
        <div
          className={`overflow-y-auto px-6 py-4 transition-all duration-300 ${
            selectedId ? 'w-[38%] border-r border-gray-200 dark:border-white/[0.06]' : 'w-full'
          }`}
        >
          {grading.loading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : grading.tasks.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="h-6 w-6" />}
              title={t('page.grading.empty')}
              description={t('page.grading.emptyDesc')}
            />
          ) : (
            <ul className="space-y-2">
              {grading.tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => grading.selectTask(task.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      task.id === selectedId
                        ? 'border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium">{task.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[task.status]}`}
                      >
                        {t(STATUS_KEYS[task.status])}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{task.semester}</span>
                      {task.className && <span>· {task.className}</span>}
                      <span>
                        ·{' '}
                        {tr('page.grading.count.papers', {
                          n: task.papers.length,
                        })}
                      </span>
                      {task.rubric.length > 0 && (
                        <span>
                          ·{' '}
                          {tr('page.grading.count.questions', {
                            n: task.rubric.length,
                          })}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 右: 任务详情 */}
        {grading.detail && (
          <div className="flex w-[62%] flex-col overflow-hidden">
            <TaskDetail
              key={grading.detail.id}
              task={grading.detail}
              students={students}
              subjectNameById={subjectNameById}
              busy={grading.busy}
              onClose={() => grading.selectTask(null)}
              onUpdateTask={grading.updateTask}
              onDeleteTask={grading.deleteTask}
              onSetStatus={grading.setStatus}
              onImportPapers={grading.importPapers}
              onAssignPaper={grading.assignPaper}
              onRemovePaper={grading.removePaper}
              onRunGrading={grading.runGrading}
              onAbortGrading={grading.abortGrading}
              onRefresh={grading.refresh}
              onPublish={grading.publish}
              onSaveReview={grading.saveReview}
            />
          </div>
        )}
      </div>

      {/* 新建任务弹层 */}
      {createOpen && (
        <TaskCreateDialog
          subjectOptions={subjectOptions}
          classOptions={classOptions}
          saving={grading.busy}
          onClose={() => setCreateOpen(false)}
          onCreate={grading.createTask}
        />
      )}
    </div>
  )
}
