// =============================================================
// useGradingData — 批改页数据/操作 hook
// 列表 + 详情 + 各 mutation;统一拆 GradingResult 信封,
// 失败消息进 errorMsg(页面顶部反馈条),成功后刷新列表与详情。
// =============================================================

import type { ImportPaperBatch } from '@shared/api/grading'
import type { GradingTask, GradingTaskStatus, TeacherReview } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

export interface RubricInput {
  name: string
  semester: string
  examDate?: string
  className?: string
  subjectId?: string
}

export function useGradingData() {
  const { t } = useT()
  const [tasks, setTasks] = useState<GradingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<GradingTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const detailIdRef = useRef<string | null>(null)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    const r = await getAPI().grading.listTasks()
    if (r.success && r.data) {
      setTasks(r.data)
    } else {
      setErrorMsg(r.error ?? 'grading.listTasks failed')
    }
    setLoading(false)
  }, [])

  const reloadDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null)
      return
    }
    const r = await getAPI().grading.getTask(id)
    if (r.success && r.data) {
      setDetail(r.data)
      detailIdRef.current = r.data.id
    } else {
      setErrorMsg(r.error ?? 'grading.getTask failed')
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const selectTask = useCallback(
    (id: string | null) => {
      detailIdRef.current = id
      setDetail(null)
      if (id) void reloadDetail(id)
    },
    [reloadDetail],
  )

  /** 统一 mutation 包装: 拆信封 → 失败/成功反馈 → 刷新 */
  const runMutation = useCallback(
    async (fn: () => Promise<{ success: boolean; error?: string }>, okNotice?: string) => {
      setBusy(true)
      setErrorMsg(null)
      const r = await fn()
      setBusy(false)
      if (!r.success) {
        setErrorMsg(r.error ?? t('page.grading.error.mutationFailed', '操作失败'))
        return false
      }
      setNotice(okNotice ?? null)
      await loadTasks()
      if (detailIdRef.current) await reloadDetail(detailIdRef.current)
      return true
    },
    [loadTasks, reloadDetail, t],
  )

  const createTask = useCallback(
    async (input: RubricInput & { rubric: unknown[] }) =>
      runMutation(() => getAPI().grading.createTask(input)),
    [runMutation],
  )

  const updateTask = useCallback(
    async (taskId: string, patch: Record<string, unknown>) =>
      runMutation(() => getAPI().grading.updateTask(taskId, patch)),
    [runMutation],
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      const ok = await runMutation(() => getAPI().grading.deleteTask(taskId))
      if (ok && detailIdRef.current === taskId) selectTask(null)
      return ok
    },
    [runMutation, selectTask],
  )

  const importPapers = useCallback(
    async (taskId: string, batches: ImportPaperBatch[]) =>
      runMutation(() => getAPI().grading.importPapers(taskId, batches)),
    [runMutation],
  )

  const assignPaper = useCallback(
    async (taskId: string, paperId: string, studentName: string | null) =>
      runMutation(() => getAPI().grading.assignPaper(taskId, paperId, studentName)),
    [runMutation],
  )

  const removePaper = useCallback(
    async (taskId: string, paperId: string) =>
      runMutation(() => getAPI().grading.removePaper(taskId, paperId)),
    [runMutation],
  )

  const setStatus = useCallback(
    async (taskId: string, status: GradingTaskStatus) =>
      runMutation(() => getAPI().grading.setStatus(taskId, status)),
    [runMutation],
  )

  /** 刷新列表与当前详情(批改作业 done 事件后由进度订阅调用) */
  const refresh = useCallback(async () => {
    await loadTasks()
    if (detailIdRef.current) await reloadDetail(detailIdRef.current)
  }, [loadTasks, reloadDetail])

  /** 启动 AI 批改(异步作业: 这里只负责启动反馈,进度走 onProgress 订阅) */
  const runGrading = useCallback(
    async (taskId: string) => {
      setBusy(true)
      setErrorMsg(null)
      const r = await getAPI().grading.run(taskId)
      setBusy(false)
      if (!r.success) {
        setErrorMsg(r.error ?? t('page.grading.error.mutationFailed', '操作失败'))
        return false
      }
      await refresh()
      return true
    },
    [refresh, t],
  )

  const abortGrading = useCallback(
    async (taskId: string) => {
      const r = await getAPI().grading.abort(taskId)
      if (!r.success) setErrorMsg(r.error ?? t('page.grading.error.mutationFailed', '操作失败'))
      return r.success
    },
    [t],
  )

  /** 保存教师复核(复核工作台) */
  const saveReview = useCallback(
    async (taskId: string, paperId: string, review: TeacherReview) => {
      setBusy(true)
      setErrorMsg(null)
      const r = await getAPI().grading.saveReview(taskId, paperId, review)
      setBusy(false)
      if (!r.success) {
        setErrorMsg(r.error ?? t('page.grading.error.mutationFailed', '操作失败'))
        return false
      }
      setNotice(t('page.grading.review.saved', '复核已保存'))
      await refresh()
      return true
    },
    [refresh, t],
  )

  /** 发布批改成绩进学业管线 */
  const publish = useCallback(
    async (taskId: string) => {
      setBusy(true)
      setErrorMsg(null)
      const r = await getAPI().grading.publish(taskId)
      setBusy(false)
      if (!r.success) {
        setErrorMsg(r.error ?? t('page.grading.error.mutationFailed', '操作失败'))
        return false
      }
      const skipped = r.data?.skipped.length ?? 0
      setNotice(
        tr('page.grading.publishDone', { n: r.data?.published ?? 0 }) +
          (skipped > 0 ? tr('page.grading.publishSkipSuffix', { n: skipped }) : ''),
      )
      await refresh()
      return true
    },
    [refresh, t],
  )

  return {
    tasks,
    loading,
    detail,
    busy,
    errorMsg,
    notice,
    clearFeedback: () => {
      setErrorMsg(null)
      setNotice(null)
    },
    loadTasks,
    selectTask,
    createTask,
    updateTask,
    deleteTask,
    importPapers,
    assignPaper,
    removePaper,
    setStatus,
    refresh,
    runGrading,
    abortGrading,
    saveReview,
    publish,
  }
}
