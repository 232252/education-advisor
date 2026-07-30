// =============================================================
// Theme Service — 同步 app 主题到 nativeTheme
// 适配 Electron 33-43 新特性:
//   E33: nativeTheme.prefersReducedTransparency (辅助功能: 减少透明度)
//   E36: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI (区分系统/应用主题)
// 作用: 让原生 UI (托盘右键菜单、系统对话框、context menu) 的明暗跟随 app 设置,
//       此前 nativeTheme 未接入,导致 light 主题下原生菜单仍为系统默认配色。
// =============================================================

import { nativeTheme } from 'electron'
import { log } from '../utils/logger'
import { settingsService } from './settings-service'

type ThemeSetting = 'dark' | 'light' | 'system'

/**
 * 将 settings.general.theme 同步到 nativeTheme.themeSource。
 * 'system' 时让 nativeTheme 跟随 OS,'dark'/'light' 时强制覆盖。
 * 应在 app.whenReady 后调用一次,并在 general.theme 变更时再次调用。
 */
export function syncNativeTheme(): void {
  try {
    const setting = settingsService.getSettings().general.theme as ThemeSetting
    // nativeTheme.themeSource 接受 'system' | 'light' | 'dark',与设置值完全对应
    nativeTheme.themeSource = setting

    // 适配 Electron 36+: shouldUseDarkColorsForSystemIntegratedUI 在 E36 引入,
    // 已安装的 electron 类型(E33)可能尚未声明,做防御性读取。
    const theme = nativeTheme as typeof nativeTheme & {
      shouldUseDarkColorsForSystemIntegratedUI?: boolean
    }
    log(
      'info',
      'theme',
      `nativeTheme synced: themeSource=${setting}, ` +
        `shouldUseDarkColors=${nativeTheme.shouldUseDarkColors}, ` +
        `shouldUseDarkColorsForSystemIntegratedUI=${theme.shouldUseDarkColorsForSystemIntegratedUI ?? 'n/a'}, ` +
        `prefersReducedTransparency=${nativeTheme.prefersReducedTransparency}`,
    )
  } catch (err) {
    // nativeTheme 在某些环境(如 headless/CI)可能不可用,降级为 no-op
    log('warn', 'theme', `syncNativeTheme failed (non-blocking): ${err}`)
  }
}
