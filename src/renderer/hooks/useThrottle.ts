// =============================================================
// useThrottle — 节流 hook
// 用于滚动、鼠标移动等高频事件,固定时间窗口内只执行一次
// =============================================================

import { useEffect, useRef, useState } from 'react'

export function useThrottle<T>(value: T, intervalMs: number = 300): T {
  const [throttled, setThrottled] = useState<T>(value)
  const lastUpdated = useRef<number>(Date.now())

  useEffect(() => {
    const now = Date.now()
    const remaining = intervalMs - (now - lastUpdated.current)
    if (remaining <= 0) {
      lastUpdated.current = now
      setThrottled(value)
      return
    }
    const timer = setTimeout(() => {
      lastUpdated.current = Date.now()
      setThrottled(value)
    }, remaining)
    return () => clearTimeout(timer)
  }, [value, intervalMs])

  return throttled
}
