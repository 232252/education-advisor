// =============================================================
// 默认设置 — DEFAULT_SETTINGS 常量
//
// 技术方向：合并 Pi settings.json + EAA config 为统一 JSON
// 单一数据源：config/default-settings.json（与 renderer SettingsPage
// 共用同一份 JSON）。类型必需字段(含 SETTINGS_V2/M33 新增与
// lastAutoAt 的 dotPath 可达性哨兵)已全部收录进 JSON,
// 此处只做结构化克隆,防止运行时修改污染 JSON 模块缓存。
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import defaultSettingsJson from '../../../../config/default-settings.json'

export const DEFAULT_SETTINGS: UnifiedSettings = structuredClone(
  defaultSettingsJson,
) as unknown as UnifiedSettings
