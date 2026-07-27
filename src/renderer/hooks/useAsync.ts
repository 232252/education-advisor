// =============================================================
// useAsync — 异步操作 hook
// 用法:
//   const { data, error, loading, run } = useAsync(async () => fetch(...))
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
}

export function useAsync<T, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
) {
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: undefined,
    loading: false,
  })
  const mounted = useRef(true)
  const fnRef = useRef(fn)
  const reqIdRef = useRef(0)
  fnRef.current = fn

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async (...args: Args) => {
      const reqId = ++reqIdRef.current
      setState({ data: undefined, error: undefined, loading: true })
      try {
        const data = await fnRef.current(...args)
        // 仅当此次调用仍是最新请求时才更新状态，避免竞态覆盖
        if (mounted.current && reqId === reqIdRef.current) {
          setState({ data, error: undefined, loading: false })
        }
        return data
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (mounted.current && reqId === reqIdRef.current) {
          setState({ data: undefined, error, loading: false })
        }
        throw error
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: 用户控制 deps
    deps,
  )

  // 首次挂载自动执行
  useEffect(() => {
    // .catch(() => {}) 防止 fn 抛错时 unhandled rejection 警告
    // 错误已通过 setState 传递给 UI，rethrow 仅供 run() 调用方可选捕获
    void run(...([] as unknown as Args)).catch(() => {})
    // biome-ignore lint/correctness/useExhaustiveDependencies: 用户控制 deps
  }, deps)

  return { ...state, run }
}
