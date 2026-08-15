// =============================================================
// Settings Service -- 统一设置管理 入口
// 技术方向：合并 Pi settings.json + EAA config 为统一 JSON
//
// 实现已按职责拆分至 settings/ 目录:
//   - defaults.ts     默认设置常量
//   - merge.ts        读写合并(深度合并 + 加载)
//   - validation.ts   schema 校验(dotPath/类型/深度防御)
//   - persistence.ts  持久化(节流写盘/原子写入/flush)
//
// 本文件保留 SettingsService 类入口与单例导出,公共方法签名不变。
// 修复：
//   P1-24: constructor 中 dataDir 改完调 save()，持久化默认值
//   P1-25: update() 校验 dotPath 格式和路径可达性
//   P1-26: save() 改为异步写盘
//   P1-27: 防御性处理中间节点为 undefined 的情况
// =============================================================

import path from 'node:path'
import type { UnifiedSettings } from '@shared/types'
import { app } from 'electron'
import { DEFAULT_SETTINGS } from './settings/defaults'
import { loadOrDefaultSync } from './settings/merge'
import {
  flush as flushPersistence,
  type PersistenceState,
  saveNow as saveNowPersistence,
  scheduleSave as scheduleSavePersistence,
} from './settings/persistence'
import { validateUpdate } from './settings/validation'

class SettingsService {
  private settingsPath: string
  private settings: UnifiedSettings
  private persistence: PersistenceState

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json')
    this.settings = loadOrDefaultSync(this.settingsPath)
    this.persistence = {
      settingsPath: this.settingsPath,
      saveTimer: null,
      writing: false,
      needsResave: false,
      lastError: null,
    }

    // 初始化时设置默认数据目录（P1-24：调 saveNow 持久化）
    if (!this.settings.general.dataDir) {
      this.settings.general.dataDir = path.join(app.getPath('userData'), 'eaa-data')
      void saveNowPersistence(this.persistence, () => this.settings)
    }
  }

  getSettings(): UnifiedSettings {
    // 深拷贝:防止外部修改嵌套对象污染内部状态
    return structuredClone(this.settings)
  }

  /**
   * 直接设置 customModels（绕过 dotPath 校验，因为 provider ID 是动态的）
   */
  setCustomModels(providerId: string, models: Array<Record<string, unknown>>): void {
    // RISK 修复: 校验 models 是数组
    if (!Array.isArray(models)) {
      throw new Error(`models must be an array, got ${typeof models}`)
    }
    if (!this.settings.models.customModels) {
      this.settings.models.customModels = {}
    }
    this.settings.models.customModels[providerId] =
      models as (typeof this.settings.models.customModels)[string]
    scheduleSavePersistence(this.persistence, () => this.settings)
  }

  /**
   * 点路径更新: 'models.defaultProvider' -> value
   * - 校验 dotPath 非空、所有段非空
   * - 校验路径在 DEFAULT_SETTINGS 中存在（防 typo）
   * - 防御性处理中间节点为 undefined
   */
  update(dotPath: string, value: unknown): void {
    validateUpdate(dotPath, value)

    const keys = dotPath.split('.')

    // 防御性遍历：中间节点为 undefined 时跳过（P1-27）
    let obj: Record<string, unknown> = this.settings as unknown as Record<string, unknown>
    for (let i = 0; i < keys.length - 1; i++) {
      const next = obj[keys[i]]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        // 中间节点已损坏（不应发生，因为 deepMerge 保证了结构）
        // 但仍要防越界
        throw new Error(
          `Cannot traverse dotPath '${dotPath}': parent is not an object at '${keys[i]}'`,
        )
      }
      obj = next as Record<string, unknown>
    }
    const lastKey = keys[keys.length - 1]
    obj[lastKey] = value
    scheduleSavePersistence(this.persistence, () => this.settings)
  }

  /** 恢复默认设置 */
  reset(): void {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as UnifiedSettings
    scheduleSavePersistence(this.persistence, () => this.settings, true)
  }

  /** 等待所有待写入完成（graceful shutdown） */
  async flush(): Promise<void> {
    return flushPersistence(this.persistence, () => this.settings)
  }

  /** 获取最近一次错误信息 */
  getLastError(): string | null {
    return this.persistence.lastError
  }
}

export const settingsService = new SettingsService()
