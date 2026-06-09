// =============================================================
// Settings Store — 全局设置 (Zustand)
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

interface SettingsState {
  settings: UnifiedSettings | null
  loading: boolean

  fetchSettings: () => Promise<void>
  updateSetting: (path: string, value: unknown) => Promise<void>
  resetSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,

  fetchSettings: async () => {
    set({ loading: true })
    try {
      const settings = await getAPI().settings.get()
      set({ settings, loading: false })
    } catch (err) {
      console.error('[SettingsStore] Failed to fetch:', err)
      toast.error('加载设置失败')
      set({ loading: false })
    }
  },

  updateSetting: async (path, value) => {
    try {
      await getAPI().settings.set(path, value)
      const settings = await getAPI().settings.get()
      set({ settings })
    } catch (err) {
      console.error('[SettingsStore] Failed to update:', err)
      toast.error(`更新设置失败: ${path}`)
    }
  },

  resetSettings: async () => {
    try {
      await getAPI().settings.reset()
      const settings = await getAPI().settings.get()
      set({ settings })
    } catch (err) {
      console.error('[SettingsStore] Failed to reset:', err)
      toast.error('重置设置失败')
    }
  },
}))
