// =============================================================
// usePrevious — 获取上一次值 hook
// 用法: const prev = usePrevious(count) — 在 effect 中拿到上一次的 count
// =============================================================

import { useEffect, useRef } from 'react'

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}
