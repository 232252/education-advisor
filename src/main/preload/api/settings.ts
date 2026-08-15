// =============================================================
// Preload API — 设置域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const settingsApi = {
  // [r] 读取设置
  get: () => ipcRenderer.invoke(IPC.IPC_SETTINGS_GET),
  // [w] 更新设置(dotPath + value)
  // R169 修复: 当修改 general.theme 时自动派发 'theme-changed' 事件,
  // 确保 useTheme hook 在任何调用路径(ThemeToggle/SettingsPage/CDP/外部脚本)
  // 下都能立即应用主题,而非仅持久化到 settings.json
  set: async (path: string, value: unknown) => {
    const result = await ipcRenderer.invoke(IPC.IPC_SETTINGS_SET, path, value)
    if (path === 'general.theme' && typeof value === 'string') {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: value }))
    }
    return result
  },
  // [c] 恢复默认 — UI 层应二次确认
  reset: () => ipcRenderer.invoke(IPC.IPC_SETTINGS_RESET),
}
