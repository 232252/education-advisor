// =============================================================
// useGlobalShortcuts — 桌面级全局快捷键(M22 从 MainLayout 抽出)
//   Ctrl/Cmd+1..9 → 切换前 9 个导航项
//   Ctrl/Cmd+,    → 设置(业界惯例)
//   Ctrl/Cmd+B    → 折叠/展开侧边栏(VS Code/JetBrains 惯例)
// =============================================================

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '../config/nav-items'

interface UseGlobalShortcutsOptions {
  /** Ctrl/Cmd+B 触发的侧边栏折叠/展开 */
  onToggleSidebar: () => void
}

export function useGlobalShortcuts({ onToggleSidebar }: UseGlobalShortcutsOptions): void {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      // 输入框/文本域/可编辑元素聚焦时不触发(避免影响打字)
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (target?.isContentEditable) return
      // Ctrl/Cmd+, → 设置(业界惯例)
      if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
        return
      }
      // Ctrl/Cmd+B → 折叠/展开侧边栏
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        onToggleSidebar()
        return
      }
      // Ctrl/Cmd+1..9 → 对应导航项
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= 9 && NAV_ITEMS[n - 1]) {
        e.preventDefault()
        navigate(NAV_ITEMS[n - 1].path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onToggleSidebar])
}
