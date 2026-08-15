// =============================================================
// 设置读写合并 — 深度合并 + 加载(默认值为底,用户设置覆盖)
//
// 修复:
//   用 deep clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
// =============================================================

import fs from 'node:fs'
import type { UnifiedSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from './defaults'

/** 深度合并:source 覆盖 target,嵌套对象递归合并,数组/原始值直接覆盖 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }
  return result
}

/** 加载 settings.json(存在则与默认值深度合并),失败或不存在时返回默认值副本 */
export function loadOrDefaultSync(settingsPath: string): UnifiedSettings {
  if (fs.existsSync(settingsPath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      // 深度合并：以默认值为底，用户设置覆盖
      return deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        stored,
      ) as unknown as UnifiedSettings
    } catch (err) {
      console.warn('[Settings] Failed to load settings.json, using defaults:', err)
      // 修复: 用 deep clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as UnifiedSettings
    }
  }
  // 修复: 用 deep clone 防止 update() 意外修改 DEFAULT_SETTINGS 的嵌套对象
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as UnifiedSettings
}
