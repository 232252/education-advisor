// =============================================================
// useToggle — 布尔切换 hook
// 用法: const [open, toggle, setOpen] = useToggle(false)
// =============================================================

import { useCallback, useState } from 'react'

export function useToggle(initial: boolean = false): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(initial)
  const toggle = useCallback(() => setValue((v) => !v), [])
  return [value, toggle, setValue]
}
