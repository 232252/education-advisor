// =============================================================
// useEAAEvents — P2 EAA 数据变更广播 Hook
// 让 StudentsPage / Dashboard / StudentProfile 在事件写入后实时刷新
//
// 用法:
//   const { lastChange, lastEventAdded, lastStudentAdded, ... } = useEAAEvents()
//   useEffect(() => { fetchStudents() }, [lastChange])   // 任意变化触发刷新
//
// 设计:
//   - lastChange: 数字单调递增, 任意事件到来 +1, 用作 useEffect 依赖
//   - 最近 50 条事件放入环形缓冲, 可用于 toast 通知 / 活动流展示
//   - 订阅生命周期与组件一致, unmount 自动退订, 不泄漏
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

/** 事件变更类型 */
export type EAAChangeType = 'event-added' | 'event-reverted' | 'student-added' | 'student-deleted'

/** 单条事件记录（环形缓冲中的元素） */
export interface EAAChangeRecord {
  type: EAAChangeType
  /** 事件序号（单调递增），可用作 React key */
  seq: number
  /** 主进程发送时间戳 */
  at: number
  /** 涉及的学生名（事件流携带） */
  studentName?: string
  /** 原因码（仅 event-added） */
  reasonCode?: string
  /** 分数变动（仅 event-added） */
  delta?: number
  /** 事件 ID（仅 event-reverted） */
  eventId?: string
}

export interface UseEAAEventsResult {
  /** 单调递增的"任意变更"序号, 用作 useEffect 依赖触发 refetch */
  lastChange: number
  /** 最近一条事件 (任意类型), 用于调试 / toast */
  lastChangeAt: number
  /** 环形缓冲: 最近 N 条事件, 顺序最新在前 */
  recent: EAAChangeRecord[]
  /** 快捷访问: 最近一条 event-added */
  lastEventAdded: EAAChangeRecord | null
  /** 快捷访问: 最近一条 event-reverted */
  lastEventReverted: EAAChangeRecord | null
  /** 快捷访问: 最近一条 student-added */
  lastStudentAdded: EAAChangeRecord | null
  /** 快捷访问: 最近一条 student-deleted */
  lastStudentDeleted: EAAChangeRecord | null
  /** 手动清空环形缓冲 (调试用) */
  clear: () => void
}

const MAX_RECENT = 50

export function useEAAEvents(): UseEAAEventsResult {
  const [seq, setSeq] = useState(0)
  const [lastAt, setLastAt] = useState(0)
  const [recent, setRecent] = useState<EAAChangeRecord[]>([])
  // 用 ref 记录序号避免闭包陈旧（保证递增唯一性）
  const seqRef = useRef(0)
  // 分类最近事件
  const [lastEventAdded, setLastEventAdded] = useState<EAAChangeRecord | null>(null)
  const [lastEventReverted, setLastEventReverted] = useState<EAAChangeRecord | null>(null)
  const [lastStudentAdded, setLastStudentAdded] = useState<EAAChangeRecord | null>(null)
  const [lastStudentDeleted, setLastStudentDeleted] = useState<EAAChangeRecord | null>(null)

  useEffect(() => {
    const api = getAPI()
    const disposers: Array<() => void> = []

    const push = (record: Omit<EAAChangeRecord, 'seq'>) => {
      seqRef.current += 1
      const full: EAAChangeRecord = { ...record, seq: seqRef.current }
      setSeq(seqRef.current)
      setLastAt(full.at)
      setRecent((prev) => {
        const next = [full, ...prev]
        if (next.length > MAX_RECENT) next.length = MAX_RECENT
        return next
      })
      if (record.type === 'event-added') setLastEventAdded(full)
      else if (record.type === 'event-reverted') setLastEventReverted(full)
      else if (record.type === 'student-added') setLastStudentAdded(full)
      else if (record.type === 'student-deleted') setLastStudentDeleted(full)
    }

    // 订阅 4 个事件通道；任一失败时静默（环境不支持时降级）
    try {
      disposers.push(
        api.eaa.onEventAdded((data) =>
          push({
            type: 'event-added',
            at: data.at,
            studentName: data.studentName,
            reasonCode: data.reasonCode,
            delta: data.delta,
          }),
        ),
      )
    } catch (err) {
      console.warn('[useEAAEvents] subscribe onEventAdded failed:', err)
    }
    try {
      disposers.push(
        api.eaa.onEventReverted((data) =>
          push({ type: 'event-reverted', at: data.at, eventId: data.eventId }),
        ),
      )
    } catch (err) {
      console.warn('[useEAAEvents] subscribe onEventReverted failed:', err)
    }
    try {
      disposers.push(
        api.eaa.onStudentAdded((data) =>
          push({ type: 'student-added', at: data.at, studentName: data.name }),
        ),
      )
    } catch (err) {
      console.warn('[useEAAEvents] subscribe onStudentAdded failed:', err)
    }
    try {
      disposers.push(
        api.eaa.onStudentDeleted((data) =>
          push({ type: 'student-deleted', at: data.at, studentName: data.name }),
        ),
      )
    } catch (err) {
      console.warn('[useEAAEvents] subscribe onStudentDeleted failed:', err)
    }

    return () => {
      for (const d of disposers) {
        try {
          d()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  return {
    lastChange: seq,
    lastChangeAt: lastAt,
    recent,
    lastEventAdded,
    lastEventReverted,
    lastStudentAdded,
    lastStudentDeleted,
    clear: () => {
      seqRef.current = 0
      setSeq(0)
      setLastAt(0)
      setRecent([])
      setLastEventAdded(null)
      setLastEventReverted(null)
      setLastStudentAdded(null)
      setLastStudentDeleted(null)
    },
  }
}
