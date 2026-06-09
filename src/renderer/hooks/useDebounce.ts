// =============================================================
// useDebounce — 防抖 hook
// 用于搜索框、resize 等高频事件,延迟执行直到停止变化 N ms
// =============================================================

import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
