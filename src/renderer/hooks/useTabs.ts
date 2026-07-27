// =============================================================
// useTabs — Tab 切换状态（可选 localStorage 持久化）
// 替换页面里手写的 useState<TabId> + localStorage 读写样板。
// 校验逻辑：持久化值不在有效集合内时回退到 defaultTab 并清理存储。
// 用法：
//   const { active, setActive } = useTabs<'a'|'b'>('a', { storageKey: 'p-a' })
//   const { active, setActive } = useTabs<'a'|'b'>('a')  // 不持久化
// =============================================================

import { useCallback, useState } from 'react'

export interface UseTabsOptions {
  /** 持久化 key；不传则不持久化 */
  storageKey?: string
}

export function useTabs<T extends string>(
  defaultTab: T,
  options: UseTabsOptions = {},
): { active: T; setActive: (tab: T) => void } {
  const { storageKey } = options
  const [active, setActiveState] = useState<T>(() => {
    if (!storageKey) return defaultTab
    const stored = localStorage.getItem(storageKey)
    //无法在此静态校验 stored 是否属于 T，由调用方保证 defaultTab 是有效值。
    //调用方通常会有 VALID_TABS 集合，建议在调用前自行校验并传 defaultTab。
    return (stored as T | null) ?? defaultTab
  })

  const setActive = useCallback(
    (tab: T) => {
      setActiveState(tab)
      if (storageKey) localStorage.setItem(storageKey, tab)
    },
    [storageKey],
  )

  return { active, setActive }
}
