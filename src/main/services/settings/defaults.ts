// =============================================================
// 默认设置 — DEFAULT_SETTINGS 常量
//
// 技术方向：合并 Pi settings.json + EAA config 为统一 JSON
// 单一数据源：config/default-settings.json（与 renderer SettingsPage
// 共用同一份 JSON，消除两处手写同步）。
// JSON 未收录但 UnifiedSettings 类型必需的字段在此补全空默认值
// （settings.set 的 dotPath 校验依赖 DEFAULT_SETTINGS 中路径存在）。
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import defaultSettingsJson from '../../../../config/default-settings.json'

// structuredClone 防止运行时修改 DEFAULT_SETTINGS 时污染 JSON 模块缓存
const json = structuredClone(defaultSettingsJson) as unknown as UnifiedSettings

export const DEFAULT_SETTINGS: UnifiedSettings = {
  ...json,
  models: {
    ...json.models,
    // JSON 未收录的类型必需字段
    providerBlacklist: [],
    customModels: {},
  },
  chat: {
    ...json.chat,
    // JSON 未收录的类型必需字段(SETTINGS_V2 新增)
    conversationLogging: true,
  },
  backup: {
    ...json.backup,
    // JSON 未收录的类型必需字段
    autoEnabled: false,
    intervalHours: 24,
    keep: 7,
    // M33: cron 驱动的定时自动备份(JSON 已收录,显式列出保持 schema 可见)
    autoBackupEnabled: false,
    autoBackupCron: '0 3 * * *',
    // 0 = 从未自动备份。必须给默认值,否则 settingsService.update('backup.lastAutoAt')
    // 的 dotPath 可达性校验(path 必须存在于 DEFAULT_SETTINGS)会拒绝写入
    lastAutoAt: 0,
  },
}
