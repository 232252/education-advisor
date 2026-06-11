// =============================================================
// useAnonymizedEAAEvents — P5 隐私过滤的事件订阅 Hook
// 在 useEAAEvents 基础上,对 studentName 字段应用隐私脱敏
//
// biome-ignore-all lint/correctness/useExhaustiveDependencies: 故意保留 rev 触发器,ref 模式不适用此异步链路
// =============================================================
//
// 用途:
//   - 教师开启隐私模式后,事件流中的"张三" → 变成化名"学生-001"
//   - 教师关闭隐私模式后,事件流立即恢复真名
//   - 隐私切换瞬间自动重新脱敏,无需手动刷新
//
// 设计选择:
//   1. 不在主进程脱敏(广播器不变) — 主进程不知道 privacy.enabled 状态
//   2. 渲染层用 usePrivacyFilter.anonymize() 异步脱敏
//   3. 新增 useAnonymizedEAAEvents 作为 useEAAEvents 的包装,保持底层 hook 纯净
//
// 性能:
//   - 复用 usePrivacyFilter 内置缓存(同名字二次进入不调 IPC)
//   - 隐私切换时 usePrivacyFilter 自动清缓存,本 hook 也会重新脱敏
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { type EAAChangeRecord, type UseEAAEventsResult, useEAAEvents } from './useEAAEvents'
import { usePrivacyFilter } from './usePrivacyFilter'

/** 脱敏后的事件记录(类型同 EAAChangeRecord,字段值可能变为化名) */
export type AnonymizedRecord = EAAChangeRecord

export interface UseAnonymizedEAAEventsResult
  extends Omit<
    UseEAAEventsResult,
    'recent' | 'lastEventAdded' | 'lastEventReverted' | 'lastStudentAdded' | 'lastStudentDeleted'
  > {
  /** 脱敏后的环形缓冲 */
  recent: AnonymizedRecord[]
  /** 脱敏后的最近一条 event-added */
  lastEventAdded: AnonymizedRecord | null
  /** 脱敏后的最近一条 event-reverted */
  lastEventReverted: AnonymizedRecord | null
  /** 脱敏后的最近一条 student-added */
  lastStudentAdded: AnonymizedRecord | null
  /** 脱敏后的最近一条 student-deleted */
  lastStudentDeleted: AnonymizedRecord | null
  /** 隐私引擎是否启用(透传,避免页面重复 import usePrivacyFilter) */
  privacyEnabled: boolean
  /** 隐私引擎是否已完成初始加载 */
  privacyInitialized: boolean
}

export function useAnonymizedEAAEvents(): UseAnonymizedEAAEventsResult {
  const {
    recent: rawRecent,
    lastEventAdded: rawEventAdded,
    lastEventReverted: rawEventReverted,
    lastStudentAdded: rawStudentAdded,
    lastStudentDeleted: rawStudentDeleted,
    lastChange,
    lastChangeAt,
    clear,
  } = useEAAEvents()

  const { enabled: privacyEnabled, initialized: privacyInitialized, anonymize } = usePrivacyFilter()

  // 脱敏缓存: rawName -> displayName(用 ref 避免重渲染)
  const cacheRef = useRef<Map<string, string>>(new Map())
  // 强制刷新: 隐私切换时让组件用新化名重渲染
  const [rev, setRev] = useState(0)

  // 隐私切换时清缓存 + 触发重渲染(下个 effect 会重新读取并更新)
  // 用 ref 读取当前隐私状态,避免 lint 警告 "extra dep not used in effect body"
  const privacyRef = useRef(privacyEnabled)
  useEffect(() => {
    if (privacyRef.current === privacyEnabled) return
    privacyRef.current = privacyEnabled
    cacheRef.current.clear()
    setRev((x) => x + 1)
  }, [privacyEnabled])

  // 同步脱敏: 当 rawRecent 变化或 rev 变化时,异步脱敏并更新 state
  const [recent, setRecent] = useState<AnonymizedRecord[]>([])
  const [eventAdded, setEventAdded] = useState<AnonymizedRecord | null>(null)
  const [eventReverted, setEventReverted] = useState<AnonymizedRecord | null>(null)
  const [studentAdded, setStudentAdded] = useState<AnonymizedRecord | null>(null)
  const [studentDeleted, setStudentDeleted] = useState<AnonymizedRecord | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      // 收集所有出现的名字
      const allNames = new Set<string>()
      for (const r of rawRecent) {
        if (r.studentName) allNames.add(r.studentName)
      }

      // 隐私关闭 → 直接复用原数组
      if (!privacyEnabled) {
        if (!cancelled) {
          setRecent(rawRecent)
          setEventAdded(rawEventAdded)
          setEventReverted(rawEventReverted)
          setStudentAdded(rawStudentAdded)
          setStudentDeleted(rawStudentDeleted)
        }
        return
      }

      // 隐私开启 → 批量脱敏(用 Promise.all 利用并行)
      const map: Record<string, string> = {}
      await Promise.all(
        Array.from(allNames).map(async (n) => {
          const cached = cacheRef.current.get(n)
          if (cached !== undefined) {
            map[n] = cached
            return
          }
          const display = await anonymize(n)
          cacheRef.current.set(n, display)
          map[n] = display
        }),
      )

      if (cancelled) return

      const rename = (r: EAAChangeRecord | null): AnonymizedRecord | null => {
        if (!r) return null
        if (!r.studentName) return r
        return { ...r, studentName: map[r.studentName] ?? r.studentName }
      }

      setRecent(rawRecent.map((r) => rename(r) as AnonymizedRecord))
      setEventAdded(rename(rawEventAdded))
      setEventReverted(rename(rawEventReverted))
      setStudentAdded(rename(rawStudentAdded))
      setStudentDeleted(rename(rawStudentDeleted))
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    rawRecent,
    rawEventAdded,
    rawEventReverted,
    rawStudentAdded,
    rawStudentDeleted,
    privacyEnabled,
    anonymize,
    rev,
  ])

  return {
    lastChange,
    lastChangeAt,
    recent,
    lastEventAdded: eventAdded,
    lastEventReverted: eventReverted,
    lastStudentAdded: studentAdded,
    lastStudentDeleted: studentDeleted,
    clear,
    privacyEnabled,
    privacyInitialized,
  }
}
