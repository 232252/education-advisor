// =============================================================
// useInterval — 间隔执行 hook(自动清理,无需手动 clearInterval)
// 用法: useInterval(() => fetch(), 5000) — 每 5 秒执行一次
// =============================================================

import { useEffect, useRef } from 'react'

export function useInterval(callback: () => void, delayMs: number | null): void {
  const savedCallback = useRef<() => void>(callback)

  // 保持最新 callback
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (delayMs === null || delayMs < 0) return
    const id = setInterval(() => savedCallback.current(), delayMs)
    return () => clearInterval(id)
  }, [delayMs])
}
