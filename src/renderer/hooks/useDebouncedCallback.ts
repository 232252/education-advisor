// =============================================================
// useDebouncedCallback — 回调防抖 hook
// 与 useDebounce 并存：useDebounce 防抖的是"值"，本 hook 防抖的是"回调调用"。
// 自动管理 timer 生命周期（卸载/re-render/fn 变化时清理），替换页面里
// 手写的 useRef<NodeJS.Timeout|null> + useEffect(cleanup) 样板。
// =============================================================

import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): (...args: TArgs) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 用 ref 持有最新 fn，避免 timer 触发时调用过期闭包
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  return useCallback(
    (...args: TArgs) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fnRef.current(...args)
      }, ms)
    },
    [ms],
  )
}
