// =============================================================
// usePrivacyFilter — P1 隐私过滤 Hook
// 全局拦截学生姓名的展示，让隐私引擎真正生效
//
// 用法:
//   const { enabled, anonymize, anonymizeBatch } = usePrivacyFilter()
//   const display = enabled ? await anonymize(student.name) : student.name
//
// 行为约定:
//   - enabled = false（默认）→ 直接返回原名（teacher 真实视图）
//   - enabled = true          → 调用 privacy.filter('public', name) 返回化名
//   - 订阅 privacy:state-changed，自动响应 enable/disable 切换
//
// 性能:
//   - 单个 anonymize: 串行 IPC
//   - 批量 anonymizeBatch: 一次 IPC 调用处理 N 个名字（用分隔符拼成大文本）
//   - 内置 useMemo 缓存：同一名字第二次不再调 IPC
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

/** 批量分隔符：极不可能在中文/英文姓名中出现，避免误切分 */
const BATCH_SEP = '\n|||\n'

export interface UsePrivacyFilterResult {
  /** 隐私引擎是否已启用（来自 IPC 广播 + 初始 settings.privacy.enabled） */
  enabled: boolean
  /** 初始状态是否已加载完成（避免 UI 闪烁） */
  initialized: boolean
  /** 单个名字脱敏；enabled=false 时原样返回 */
  anonymize: (name: string) => Promise<string>
  /** 批量脱敏，返回 { 原名: 显示名 }；enabled=false 时返回 identity map */
  anonymizeBatch: (names: string[]) => Promise<Record<string, string>>
}

export function usePrivacyFilter(): UsePrivacyFilterResult {
  const [enabled, setEnabled] = useState(false)
  const [initialized, setInitialized] = useState(false)
  // 缓存：避免同一名字多次 IPC 调用
  const cacheRef = useRef<Map<string, string>>(new Map())

  // 初始状态：从 settings.privacy.enabled 读取（最便宜的来源）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const settings = await getAPI().settings.get()
        if (cancelled) return
        // settings 形状: { privacy: { enabled, autoAnonymize } } — 兼容两种字段名
        const privacy = (settings as { privacy?: { enabled?: boolean } })?.privacy
        setEnabled(privacy?.enabled === true)
      } catch (err) {
        console.warn('[usePrivacyFilter] Failed to read settings:', err)
      } finally {
        if (!cancelled) setInitialized(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 订阅 enable/disable 状态变化
  useEffect(() => {
    try {
      const dispose = getAPI().privacy.onStateChanged(({ enabled: next }) => {
        setEnabled(next)
        // 状态切换时清缓存（避免旧化名/旧真名混用）
        cacheRef.current.clear()
      })
      return dispose
    } catch (err) {
      console.warn('[usePrivacyFilter] Failed to subscribe onStateChanged:', err)
      return undefined
    }
  }, [])

  const anonymize = useCallback(
    async (name: string): Promise<string> => {
      if (!name) return name
      // 隐私未启用 → 直接返回原名（teacher 真实视图）
      if (!enabled) return name
      // 查缓存
      const cached = cacheRef.current.get(name)
      if (cached !== undefined) return cached
      try {
        // P1 设计：UI 展示用 'public' 接收者 → 全部脱敏为化名
        // （teacher:self 接收者不会脱敏，不适用于"开启隐私就要看到化名"的预期）
        const res = await getAPI().privacy.filter('public', name)
        let display: string = name
        if (res.success) {
          // EAAResult.data 可能是 string 或 { filtered: string }
          const data = res.data as unknown
          if (typeof data === 'string') {
            display = data
          } else if (data && typeof data === 'object') {
            const obj = data as Record<string, unknown>
            const candidate = obj.filtered ?? obj.text ?? obj.result
            if (typeof candidate === 'string') display = candidate
          }
        }
        cacheRef.current.set(name, display)
        return display
      } catch (err) {
        console.warn('[usePrivacyFilter] anonymize failed for', name, err)
        return name
      }
    },
    [enabled],
  )

  const anonymizeBatch = useCallback(
    async (names: string[]): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      if (names.length === 0) return out
      if (!enabled) {
        for (const n of names) out[n] = n
        return out
      }
      // 过滤已缓存的
      const toFetch: string[] = []
      for (const n of names) {
        const cached = cacheRef.current.get(n)
        if (cached !== undefined) out[n] = cached
        else toFetch.push(n)
      }
      if (toFetch.length === 0) return out
      try {
        // 拼成大文本一次过 Rust 端，节省 IPC 次数
        const combined = toFetch.join(BATCH_SEP)
        const res = await getAPI().privacy.filter('public', combined)
        let parts: string[] = toFetch // 失败兜底：原样返回
        if (res.success) {
          const data = res.data as unknown
          if (typeof data === 'string') {
            parts = data.split(BATCH_SEP)
          } else if (data && typeof data === 'object') {
            const obj = data as Record<string, unknown>
            const candidate = obj.filtered ?? obj.text ?? obj.result
            if (typeof candidate === 'string') parts = candidate.split(BATCH_SEP)
          }
        }
        // 长度不一致时兜底：保持原名
        for (let i = 0; i < toFetch.length; i++) {
          const original = toFetch[i]
          const display = parts[i] ?? original
          out[original] = display
          cacheRef.current.set(original, display)
        }
        return out
      } catch (err) {
        console.warn('[usePrivacyFilter] anonymizeBatch failed:', err)
        for (const n of toFetch) out[n] = n
        return out
      }
    },
    [enabled],
  )

  return { enabled, initialized, anonymize, anonymizeBatch }
}
