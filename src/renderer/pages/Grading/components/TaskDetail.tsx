// =============================================================
// TaskDetail — 批改任务详情(右侧面板)
// 元信息 + 状态操作 + 量规编辑(draft/ready 可编辑,之后只读) + 试卷表
// + AI 批改启动/中止/重试失败 与实时进度(订阅 grading:progress)。
// P4 接「复核/发布」入口。
// =============================================================

import type { GradingRosterEntry } from '@shared/api/grading'
import { cleanPresetMarks } from '@shared/grading-helpers'
import type {
  EAAStudent,
  GradingProgressEvent,
  GradingTask,
  RubricQuestion,
  TeacherReview,
} from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import {
  GradingMarksDocument,
  type GradingMarksMode,
} from '../../../components/print/GradingMarksDocument'
import { OverlayPrintDocument } from '../../../components/print/OverlayPrintDocument'
import { PrintOverlay } from '../../../components/print/PrintOverlay'
import { useIpcSubscription } from '../../../hooks/useIpcSubscription'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn } from '../../../lib/ui-utils'
import { useClassStore } from '../../../stores/class/store'
import { useGradingMarksPrint } from '../hooks/useGradingMarksPrint'
import { PapersTable } from './PapersTable'
import { ReviewWorkbench } from './ReviewWorkbench'
import { RubricEditor } from './RubricEditor'

/** 任务状态 → 徽章 i18n 键(显式枚举,不用模板动态键) */
const TASK_STATUS_KEYS = {
  draft: 'page.grading.status.draft',
  ready: 'page.grading.status.ready',
  grading: 'page.grading.status.grading',
  review: 'page.grading.status.review',
  published: 'page.grading.status.published',
} as const

/** 批改口径 → i18n 键(显式枚举,不用模板动态键) */
const TASK_MODE_KEYS = {
  strict: 'page.grading.mode.strict',
  normal: 'page.grading.mode.normal',
  lenient: 'page.grading.mode.lenient',
} as const

/** 批改模式 → i18n 键(显式枚举,不用模板动态键) */
const TASK_STRATEGY_KEYS = {
  fast: 'page.grading.strategy.fast',
  standard: 'page.grading.strategy.standard',
  dual: 'page.grading.strategy.dual',
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
  onRunGrading: (taskId: string, roster?: GradingRosterEntry[]) => Promise<boolean>
  onRegradePapers: (taskId: string, paperIds: string[]) => Promise<boolean>
  onIdentifyPapers: (taskId: string, roster: GradingRosterEntry[]) => Promise<boolean>
  onAbortGrading: (taskId: string) => Promise<boolean>
  onRefresh: () => Promise<void>
  onPublish: (taskId: string) => Promise<boolean>
  onSaveReview: (taskId: string, paperId: string, review: TeacherReview) => Promise<boolean>
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
  onRegradePapers,
  onIdentifyPapers,
  onAbortGrading,
  onRefresh,
  onPublish,
  onSaveReview,
}: TaskDetailProps) {
  const { t } = useT()
  const [rubricDraft, setRubricDraft] = useState<RubricQuestion[]>(task.rubric)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [progress, setProgress] = useState<GradingProgressEvent | null>(null)
  const [reviewingPaperId, setReviewingPaperId] = useState<string | null>(null)
  // 本班名单为空时教师显式选择「显示全校」;默认严格限定本班,不再静默回退全校
  const [showAllStudents, setShowAllStudents] = useState(false)
  const marksPrint = useGradingMarksPrint()
  // 打印版式: 痕迹卷(重印照片) / 批阅报告 / 套打原卷(红笔回写)
  const [marksMode, setMarksMode] = useState<GradingMarksMode>('paper')
  const classList = useClassStore((s) => s.items)
  const classOptions = useMemo(() => classList.filter((c) => !c.archived), [classList])

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
  const unassignedCount = task.papers.filter((p) => p.studentName === null).length
  // 历史任务只存过班级名:按名称反查班级库兜底解析出 classId
  const resolvedClassId =
    task.classId ?? classOptions.find((c) => c.name === task.className)?.class_id ?? null
  const rosterStudents = useMemo<EAAStudent[]>(() => {
    const active = students.filter((s) => s.status === 'Active')
    const scoped = resolvedClassId ? active.filter((s) => s.class_id === resolvedClassId) : active
    // 本班在读名单为空时不再静默回退全校:留给教师显式决定(见 classRosterEmpty 警告条)
    if (scoped.length > 0) return scoped
    if (resolvedClassId) return showAllStudents ? active : []
    return active
  }, [students, resolvedClassId, showAllStudents])
  const classRosterEmpty = resolvedClassId !== null && rosterStudents.length === 0
  const roster = useMemo<GradingRosterEntry[]>(
    // 只送姓名:卷面上只会出现姓名/学号/考号,entity_id 等非数字别名
    // 对身份匹配没有意义,反而会把「考号 01」误配到 ent_xxx01(09-13 实测)。
    // 学号/考号别名由主进程 enrichRosterWithProfiles 从档案补齐。
    () => rosterStudents.map((s) => ({ name: s.name })),
    [rosterStudents],
  )
  const canRun =
    (task.status === 'ready' || task.status === 'review') &&
    pendingCount + failedCount + unassignedCount > 0
  const running = task.status === 'grading'
  // 可复核 = 有 AI 结果的试卷(复核/已发布态);双评分歧卷置顶(教师优先仲裁)
  const reviewablePapers = task.papers
    .filter((p) => p.ai)
    .sort((a, b) => (b.disputedQuestions?.length ?? 0) - (a.disputedQuestions?.length ?? 0))
  const reviewable =
    (task.status === 'review' || task.status === 'published') && reviewablePapers.length > 0

  const saveRubric = async () => {
    const cleaned = rubricDraft
      .filter((q) => q.title.trim().length > 0 && q.fullMark > 0)
      .map((q, i) => {
        const marks = cleanPresetMarks(q.presetMarks)
        return { ...q, order: i + 1, presetMarks: marks }
      })
    await onUpdateTask(task.id, { rubric: cleaned })
  }

  /** 导入成功后自动跑一轮卷面识别(读姓名/编号→留痕+唯一命中自动归组),教师只需纠正例外 */
  const handleImportPapers: TaskDetailProps['onImportPapers'] = async (taskId, batches) => {
    const ok = await onImportPapers(taskId, batches)
    if (
      ok &&
      roster.length > 0 &&
      (task.status === 'draft' || task.status === 'ready' || task.status === 'review')
    ) {
      await onIdentifyPapers(taskId, roster)
    }
    return ok
  }

  const metaChip = (label: string, value?: string) =>
    value ? (
      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
        {label}: {value}
      </span>
    ) : null

  // 口径归一: 历史/手改任务 JSON 可能缺字段或带非法值,一律按正常展示
  const gradingMode =
    task.gradingMode === 'strict' || task.gradingMode === 'lenient' ? task.gradingMode : 'normal'
  // 模式归一: 缺省/非法回落 standard
  const gradingStrategy: 'fast' | 'standard' | 'dual' =
    task.gradingStrategy === 'fast' || task.gradingStrategy === 'dual'
      ? task.gradingStrategy
      : 'standard'

  const marksOverlay =
    marksPrint.task && marksPrint.views ? (
      <PrintOverlay
        title={
          marksPrint.views.length === 1
            ? `${t('print.gradingMarks.title', '批阅痕迹')} — ${marksPrint.views[0]?.paper.studentName ?? t('print.gradingMarks.unassigned', '未归组')}`
            : `${t('print.gradingMarks.title', '批阅痕迹')} — ${marksPrint.task.name} (${tr('page.grading.count.papers', { n: marksPrint.views.length })})`
        }
        onClose={marksPrint.close}
        printLabel={
          marksMode === 'overlay' ? t('page.grading.overlay.printPreview', '打印预览') : undefined
        }
        toolbarHint={
          marksMode === 'overlay'
            ? t('page.grading.overlay.toolbarHint', '红笔套回原卷 · 不重印卷面')
            : undefined
        }
        toolbarExtra={
          <span className="flex items-center gap-1 rounded-md bg-white/10 p-0.5">
            {(
              [
                {
                  id: 'paper' as const,
                  hint: t('page.grading.printMode.paperHint', '重印批过的照片'),
                },
                {
                  id: 'report' as const,
                  hint: t('page.grading.printMode.reportHint', '得分表与评语'),
                },
                {
                  id: 'overlay' as const,
                  hint: t('page.grading.printMode.overlayHint', '红笔套回手里的原卷'),
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                onClick={() => setMarksMode(m.id)}
                className={
                  marksMode === m.id
                    ? 'rounded bg-white px-2 py-0.5 text-xs font-medium text-gray-900'
                    : 'rounded px-2 py-0.5 text-xs text-gray-300 hover:text-white'
                }
              >
                {t(
                  m.id === 'paper'
                    ? 'page.grading.printMode.paper'
                    : m.id === 'report'
                      ? 'page.grading.printMode.report'
                      : 'page.grading.printMode.overlay',
                )}
              </button>
            ))}
          </span>
        }
        contentClassName={
          marksMode === 'paper'
            ? '!px-2 !py-2'
            : marksMode === 'overlay'
              ? '!w-auto !max-w-none !min-h-0 !px-0 !py-0 !my-0 !rounded-none !shadow-none !bg-[#e4dfd4]'
              : undefined
        }
      >
        {marksMode === 'overlay' ? (
          <OverlayPrintDocument
            task={marksPrint.task}
            views={marksPrint.views}
            onRefresh={onRefresh}
          />
        ) : (
          <GradingMarksDocument task={marksPrint.task} papers={marksPrint.views} mode={marksMode} />
        )}
      </PrintOverlay>
    ) : null

  // 复核模式: 双栏工作台替换详情主体
  if (reviewingPaperId) {
    const target = task.papers.find((p) => p.id === reviewingPaperId) ?? reviewablePapers[0] ?? null
    if (target) {
      return (
        <>
          <ReviewWorkbench
            task={task}
            paperId={target.id}
            reviewablePapers={reviewablePapers}
            onClose={() => setReviewingPaperId(null)}
            onNavigate={setReviewingPaperId}
            onSaveReview={onSaveReview}
            onPrintMarks={(paper) => void marksPrint.printPapers(task, [paper])}
            printLoading={marksPrint.loading}
          />
          {marksOverlay}
        </>
      )
    }
    setReviewingPaperId(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部: 名称 + 状态徽章 + 操作 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-white/[0.06]">
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
            onClick={() => void onRunGrading(task.id, roster)}
            disabled={busy}
            className={btnStyle('primary')}
          >
            {task.status === 'review' && failedCount > 0
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
        {reviewable && (
          <button
            type="button"
            onClick={() => setReviewingPaperId(reviewablePapers[0]?.id ?? null)}
            className={btnStyle('primary')}
          >
            {t('page.grading.review.open')}
          </button>
        )}
        {reviewablePapers.length > 0 && (
          <button
            type="button"
            onClick={() => void marksPrint.printPapers(task, reviewablePapers)}
            disabled={busy || marksPrint.loading}
            className={btnStyle('secondary')}
            title={t('page.grading.exportMarksTitle', '把卷面批注与得分导出为可打印 PDF')}
          >
            {marksPrint.loading
              ? t('page.grading.exportMarksLoading', '正在准备打印…')
              : t('page.grading.exportMarks', '导出批阅痕迹')}
          </button>
        )}
        {(task.status === 'review' || task.status === 'published') &&
          reviewablePapers.length > 0 && (
            <button
              type="button"
              onClick={() => void onPublish(task.id)}
              disabled={busy}
              className={btnStyle('primary')}
            >
              {task.status === 'published'
                ? t('page.grading.republish')
                : t('page.grading.publish')}
            </button>
          )}
        {task.status === 'published' && (
          <button
            type="button"
            onClick={() => void onSetStatus(task.id, 'review')}
            disabled={busy}
            className={btnStyle('secondary')}
            title={t('page.grading.unpublishTitle')}
          >
            {t('page.grading.unpublish')}
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
        <div className="flex flex-wrap items-center gap-1.5">
          {metaChip(t('page.grading.task.semester'), task.semester)}
          {metaChip(t('page.grading.task.date'), task.examDate)}
          {task.status === 'grading' ? (
            metaChip(t('page.grading.task.class'), task.className)
          ) : (
            <label
              className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300"
              title={t(
                'page.grading.task.classScopeTitle',
                '试卷归属与姓名识别默认只用该班级在读学生；不选则用全校名单',
              )}
            >
              {t('page.grading.task.class')}
              <select
                value={resolvedClassId ?? ''}
                onChange={(e) => {
                  const cls = classOptions.find((c) => c.class_id === e.target.value)
                  void onUpdateTask(task.id, {
                    classId: cls?.class_id,
                    className: cls?.name,
                  })
                }}
                disabled={busy}
                className="cursor-pointer bg-transparent font-medium outline-none"
              >
                <option value="">{t('page.grading.task.classAll', '全校名单')}</option>
                {classOptions.map((c) => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!resolvedClassId && task.className && (
                <span
                  className="text-amber-600 dark:text-amber-400"
                  title={t(
                    'page.grading.detail.classUnmatchedTitle',
                    '原班级名在班级库中不存在，请重新选择班级',
                  )}
                >
                  ({task.className})
                </span>
              )}
            </label>
          )}
          {metaChip(
            t('page.grading.task.subject'),
            task.subjectId ? subjectNameById.get(task.subjectId) : undefined,
          )}
          {task.status === 'grading' ? (
            metaChip(t('page.grading.mode.label'), t(TASK_MODE_KEYS[gradingMode]))
          ) : (
            <label
              className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300"
              title={t(
                'page.grading.mode.title',
                '给分松紧口径，影响 AI 批改的扣分尺度；改动后对之后的批改/重改生效',
              )}
            >
              {t('page.grading.mode.label', '批改口径')}
              <select
                value={gradingMode}
                onChange={(e) => void onUpdateTask(task.id, { gradingMode: e.target.value })}
                disabled={busy}
                className="cursor-pointer bg-transparent font-medium outline-none"
              >
                <option value="normal">{t('page.grading.mode.normal', '正常')}</option>
                <option value="strict">{t('page.grading.mode.strict', '严格')}</option>
                <option value="lenient">{t('page.grading.mode.lenient', '宽松')}</option>
              </select>
            </label>
          )}
          {task.status === 'grading' ? (
            metaChip(t('page.grading.strategy.label'), t(TASK_STRATEGY_KEYS[gradingStrategy]))
          ) : (
            <label
              className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300"
              title={t(
                'page.grading.strategy.title',
                '批改流程档位：调用次数与准确率的权衡；改动后对之后的批改/重改生效',
              )}
            >
              {t('page.grading.strategy.label', '批改模式')}
              <select
                value={gradingStrategy}
                onChange={(e) =>
                  void onUpdateTask(task.id, { gradingStrategy: e.target.value as never })
                }
                disabled={busy}
                className="cursor-pointer bg-transparent font-medium outline-none"
              >
                <option value="fast">{t('page.grading.strategy.fast', '快改 · 整卷一次')}</option>
                <option value="standard">
                  {t('page.grading.strategy.standard', '标准 · 分题细改+复验')}
                </option>
                <option value="dual">
                  {t('page.grading.strategy.dual', '双评 · 双AI独立批改')}
                </option>
              </select>
            </label>
          )}
        </div>

        {/* 本班在读名单为空:显式警告,不再静默回退全校 */}
        {classRosterEmpty && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <span className="flex-1">
              {tr('page.grading.detail.classRosterEmpty', {
                className: task.className ?? resolvedClassId ?? '',
              })}
            </span>
            <button
              type="button"
              onClick={() => setShowAllStudents(true)}
              disabled={busy}
              className="shrink-0 rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-500/20"
            >
              {t('page.grading.detail.showAllStudents', '显示全校学生')}
            </button>
          </div>
        )}
        {resolvedClassId !== null && showAllStudents && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
            <span className="flex-1">{t('page.grading.detail.showingAllStudents')}</span>
            <button
              type="button"
              onClick={() => setShowAllStudents(false)}
              disabled={busy}
              className="shrink-0 rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 dark:border-white/20 dark:hover:bg-white/10"
            >
              {t('page.grading.detail.backToClassStudents', '恢复只看本班')}
            </button>
          </div>
        )}

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
                      : progress.phase === 'identify'
                        ? tr('page.grading.progress.identify', {
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
                {progress.phase === 'stage' && (
                  <div className="text-[11px] text-amber-600/90 dark:text-amber-300/80">
                    {tr('page.grading.progress.stage', {
                      stage: progress.stage ?? '',
                      index: progress.stageIndex ?? 0,
                      total: progress.stageTotal ?? 0,
                    })}
                  </div>
                )}
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
                  {(q.presetMarks?.length ?? 0) > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {(q.presetMarks ?? []).map((m) => (
                        <li
                          key={`${q.id}-ro-${m.note}-${m.points}`}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300"
                        >
                          {m.points > 0 ? '+' : ''}
                          {m.points} {m.note}
                        </li>
                      ))}
                    </ul>
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
            students={rosterStudents}
            busy={busy}
            onImport={handleImportPapers}
            onAssign={onAssignPaper}
            onRemove={onRemovePaper}
            onReview={reviewable ? setReviewingPaperId : undefined}
            onExportMarks={
              reviewablePapers.length > 0
                ? (paperId) => {
                    const paper = task.papers.find((p) => p.id === paperId)
                    if (paper) void marksPrint.printPapers(task, [paper])
                  }
                : undefined
            }
            exportMarksLoading={marksPrint.loading}
            onRegrade={
              !running && task.status !== 'draft' && task.status !== 'ready'
                ? (paperId) => onRegradePapers(task.id, [paperId])
                : undefined
            }
            onIdentify={
              unassignedCount > 0 &&
              roster.length > 0 &&
              (task.status === 'draft' || task.status === 'ready' || task.status === 'review')
                ? () => void onIdentifyPapers(task.id, roster)
                : undefined
            }
          />
        </section>
      </div>
      {marksOverlay}
    </div>
  )
}
