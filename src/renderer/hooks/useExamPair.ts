// =============================================================
// useExamPair — 考试对比的选择状态 + 操行分区间数据
// 从 AcademicsTab/Students.AcademicsTab 两处同构内联逻辑收敛而来:
//   useExamPairSelection  默认选最近两场(升序倒数第二与最后一场)
//   useConductEvents      两场考试日期区间内的 EAA 事件(操行分)
// =============================================================

import type { EAAEventRecord, ExamDef } from '@shared/types'
import { useEffect, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

/** 考试 A/B 选择状态;不足两场时不预选(空串) */
export function useExamPairSelection(sortedExams: ExamDef[]) {
  const [examAId, setExamAId] = useState(() =>
    sortedExams.length >= 2 ? sortedExams[sortedExams.length - 2].id : '',
  )
  const [examBId, setExamBId] = useState(() =>
    sortedExams.length >= 2 ? sortedExams[sortedExams.length - 1].id : '',
  )

  // 考试列表晚到(异步加载)时补默认值;已手动选择的不覆盖
  useEffect(() => {
    if (sortedExams.length < 2) return
    setExamAId((prev) => prev || sortedExams[sortedExams.length - 2].id)
    setExamBId((prev) => prev || sortedExams[sortedExams.length - 1].id)
  }, [sortedExams])

  return { examAId, setExamAId, examBId, setExamBId }
}

/**
 * 两场考试日期区间内的操行事件。
 * 任一场考试不存在(或 id 为空)时返回 null — 与"无操行分数据"同型,
 * 由 metrics 层按 null 跳过操行对比;区间查询失败同样回退 null,不打断对比主流程。
 */
export function useConductEvents(
  exams: ExamDef[],
  examAId: string,
  examBId: string,
  limit: number,
): EAAEventRecord[] | null {
  const [events, setEvents] = useState<EAAEventRecord[] | null>(null)

  useEffect(() => {
    const examA = exams.find((e) => e.id === examAId)
    const examB = exams.find((e) => e.id === examBId)
    if (!examAId || !examBId || !examA?.date || !examB?.date) {
      setEvents(null)
      return
    }
    // 代际防护: 切换考试对后,晚到的旧响应不得覆盖新数据
    let cancelled = false
    void (async () => {
      try {
        const res = await getAPI().eaa.range(examA.date, examB.date, limit)
        if (!cancelled) setEvents(res.success && res.data ? res.data.events : null)
      } catch (err) {
        console.warn('[useExamPair] eaa.range failed:', err)
        if (!cancelled) setEvents(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [exams, examAId, examBId, limit])

  return events
}
