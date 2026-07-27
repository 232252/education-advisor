// =============================================================
// useDataLoader — 统一数据加载 Hook
// 封装 loading/error/data 状态管理 + toast 错误提示，
// 消除各页面重复的 useCallback + try/catch + setLoading 模式。
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../stores/toastStore'

interface UseDataLoaderOptions<T> {
  /** 数据获取函数 */
  fetcher: () => Promise<T>
  /** 加载失败时的 toast 前缀（可选，不传则不弹 toast） */
  errorPrefix?: string
  /** 初始值 */
  initialData?: T
  /** 是否立即加载（默认 true） */
  immediate?: boolean
}

interface UseDataLoaderReturn<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** 手动触发加载 */
  load: () => Promise<void>
  /** 直接设置数据（用于乐观更新） */
  setData: (data: T | null) => void
}

export function useDataLoader<T>({
  fetcher,
  errorPrefix,
  initialData,
  immediate = true,
}: UseDataLoaderOptions<T>): UseDataLoaderReturn<T> {
  const [data, setData] = useState<T | null>(initialData as T | null)
  const [loading, setLoading] = useState(immediate)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef(false)
  const mountedRef = useRef(true)
  // 修复: 请求令牌防止竞态(快速连续调用 load() 时旧响应覆盖新数据)
  const reqIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      // 修复: 仅当这是最新请求时才更新状态,避免竞态
      if (mountedRef.current && reqId === reqIdRef.current) {
        setData(result)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (mountedRef.current && reqId === reqIdRef.current) {
        setError(msg)
      }
      if (errorPrefix) {
        toast.error(`${errorPrefix}: ${msg}`)
      }
    } finally {
      if (mountedRef.current && reqId === reqIdRef.current) {
        setLoading(false)
      }
    }
  }, [fetcher, errorPrefix])

  // 立即加载（使用 useEffect 避免在渲染中触发状态更新）
  useEffect(() => {
    if (immediate && !loadedRef.current) {
      loadedRef.current = true
      load()
    }
  }, [immediate, load])

  return { data, loading, error, load, setData }
}
