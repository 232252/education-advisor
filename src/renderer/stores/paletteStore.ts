// =============================================================
// Palette Store — 全局命令面板开关状态 (Zustand)
// 侧边栏触发按钮 / Ctrl+K 快捷键 / 面板自身共用同一状态。
// 用法:
//   const open = usePaletteStore((s) => s.open)
//   usePaletteStore.getState().toggle()
// =============================================================

import { create } from 'zustand'

interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
