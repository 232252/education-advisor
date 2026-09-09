// =============================================================
// usePaletteHotkey — Ctrl+K / Cmd+K 全局唤起命令面板
// 独立成钩子的原因: 面板本体已懒加载(MainLayout 按 open 状态挂载),
// 未挂载时其内部监听不存在 — 热键必须常驻 MainLayout;
// 独立文件让测试可以组合「钩子+面板」验证完整开关链路。
// =============================================================

import { useEffect } from 'react'
import { usePaletteStore } from '../../stores/paletteStore'

export function usePaletteHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        e.stopPropagation()
        usePaletteStore.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
