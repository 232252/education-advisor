// =============================================================
// 设置读写合并 — 深度合并 + 加载(默认值为底,用户设置覆盖)
//
// 深度合并实现收敛到 @shared/deep-merge(与渲染层 partial 合并同一来源)。
//
// 修复:
//   用 structured clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
// =============================================================

import fs from 'node:fs'
import { deepMergeSettings } from '@shared/deep-merge'
import type { UnifiedSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from './defaults'

/** 加载 settings.json(存在则与默认值深度合并),失败或不存在时返回默认值副本 */
export function loadOrDefaultSync(settingsPath: string): UnifiedSettings {
  if (fs.existsSync(settingsPath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      // 深度合并：以默认值为底，用户设置覆盖
      return deepMergeSettings(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        stored,
      ) as unknown as UnifiedSettings
    } catch (err) {
      console.warn('[Settings] Failed to load settings.json, using defaults:', err)
      // structured clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
      return structuredClone(DEFAULT_SETTINGS)
    }
  }
  // structured clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
  return structuredClone(DEFAULT_SETTINGS)
}
