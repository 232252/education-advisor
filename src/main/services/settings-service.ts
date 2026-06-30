// =============================================================
// Settings Service -- 统一设置管理
// 技术方向：合并 Pi settings.json + EAA config 为统一 JSON
// 修复：
//   P1-24: constructor 中 dataDir 改完调 save()，持久化默认值
//   P1-25: update() 校验 dotPath 格式和路径可达性
//   P1-26: save() 改为异步写盘
//   P1-27: 防御性处理中间节点为 undefined 的情况
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { UnifiedSettings } from '../../shared/types'

const DEFAULT_SETTINGS: UnifiedSettings = {
  general: {
    dataDir: '',
    defaultOperator: '',
    theme: 'dark',
    language: 'zh-CN',
    autoUpdate: true,
    updateUrl: '',
    telemetry: false,
    logLevel: 'info',
    autoStart: false,
    minimizeToTray: true,
    closeBehavior: 'ask',
    // H-4 修复: cron 调度时区默认值
    timezone: 'Asia/Shanghai',
  },
  models: {
    defaultProvider: '',
    defaultModel: '',
    highQualityModel: '',
    lowCostModel: '',
    enabledModels: [],
    transport: 'auto',
    cacheRetention: 'short',
    retry: {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 1000,
      providerTimeoutMs: 60000,
    },
    providerBlacklist: [],
    customModels: {},
  },
  chat: {
    compaction: {
      enabled: true,
      reserveTokens: 8000,
      keepRecentTokens: 16000,
    },
    steeringMode: 'all',
    followUpMode: 'all',
    showImages: true,
    maxTokens: 32768,
    conversationLogging: true,
    thinkingLevel: 'medium',
  },
  privacy: {
    enabled: false,
    autoAnonymize: false,
  },
  feishu: {
    appId: '',
    appSecret: '',
    userOpenId: '',
    bitableAppToken: '',
    bitableTableId: '',
    bitableSync: {
      enabled: false,
      syncInterval: '0 */6 * * *',
    },
  },
  advanced: {
    shellPath: '',
    sessionDir: '',
    httpIdleTimeoutMs: 120000,
  },
  shortcuts: {
    'chat.new': 'Ctrl+N',
    'chat.send': 'Enter',
    'chat.abort': 'Escape',
    'nav.agents': 'Ctrl+Shift+A',
    'nav.models': 'Ctrl+Shift+M',
    'nav.settings': 'Ctrl+,',
    'nav.scheduler': 'Ctrl+Shift+T',
  },
}

class SettingsService {
  private settingsPath: string
  private settings: UnifiedSettings
  /** 待写入的 setTimeout id（用于节流） */
  private saveTimer: NodeJS.Timeout | null = null
  /** 上次错误信息 */
  private _lastError: string | null = null
  /** 是否有未完成的写入 */
  private _writing = false

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json')
    this.settings = this.loadOrDefaultSync()

    // 初始化时设置默认数据目录（P1-24：调 saveNow 持久化）
    if (!this.settings.general.dataDir) {
      this.settings.general.dataDir = path.join(app.getPath('userData'), 'eaa-data')
      void this.saveNow()
    }
  }

  private loadOrDefaultSync(): UnifiedSettings {
    if (fs.existsSync(this.settingsPath)) {
      try {
        const stored = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'))
        // 深度合并：以默认值为底，用户设置覆盖
        return this.deepMerge(
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

  private deepMerge(
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
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        )
      } else {
        result[key] = sourceVal
      }
    }
    return result
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
    this.scheduleSave()
  }

  /**
   * 点路径更新: 'models.defaultProvider' -> value
   * - 校验 dotPath 非空、所有段非空
   * - 校验路径在 DEFAULT_SETTINGS 中存在（防 typo）
   * - 防御性处理中间节点为 undefined
   */
  update(dotPath: string, value: unknown): void {
    if (typeof dotPath !== 'string' || dotPath.length === 0) {
      throw new Error('dotPath must be a non-empty string')
    }
    const keys = dotPath.split('.')
    if (keys.some((k) => k.length === 0)) {
      throw new Error(`dotPath contains empty segment: ${dotPath}`)
    }

    // RISK 修复 + CONCERN 修复: 基本类型校验,防止 JSON.stringify 抛错或数据污染
    // 拒绝 undefined / null / function / symbol / bigint
    if (
      value === undefined ||
      value === null ||
      typeof value === 'function' ||
      typeof value === 'symbol' ||
      typeof value === 'bigint'
    ) {
      throw new Error(`Invalid value type for ${dotPath}: ${typeof value}`)
    }
    // 拒绝 NaN 和 Infinity (JSON.stringify 会把它们变成 null,静默丢数据)
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Invalid number value for ${dotPath}: ${value} (NaN/Infinity not allowed)`)
    }
    // 防止超长字符串撑爆 settings.json
    if (typeof value === 'string' && value.length > 1_000_000) {
      throw new Error(`Value too long for ${dotPath}: ${value.length} chars (max 1,000,000)`)
    }
    // 对象深度限制:防止恶意/意外深嵌套对象导致 JSON.stringify 栈溢出
    if (typeof value === 'object') {
      const depth = SettingsService._getObjectDepth(value)
      if (depth > 10) {
        throw new Error(`Object depth too deep for ${dotPath}: ${depth} (max 10)`)
      }
    }

    // 校验路径在默认设置中存在
    let probe: unknown = DEFAULT_SETTINGS as unknown as Record<string, unknown>
    for (const key of keys) {
      if (probe === null || typeof probe !== 'object' || Array.isArray(probe)) {
        throw new Error(`Invalid dotPath (parent is not object): ${dotPath}`)
      }
      probe = (probe as Record<string, unknown>)[key]
      if (probe === undefined) {
        throw new Error(`dotPath not found in default settings: ${dotPath}`)
      }
    }

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
    this.scheduleSave()
  }

  /** 恢复默认设置 */
  reset(): void {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    this.scheduleSave(true)
  }

  /**
   * 节流保存：500ms 内的多次 update 合并为一次写入
   * 立即保存可用 saveNow()（fire-and-forget）
   */
  private scheduleSave(immediate = false): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (immediate) {
      void this.saveNow()
    } else {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        void this.saveNow()
      }, 300)
    }
  }

  /** 异步写盘，不阻塞主进程（P1-26） */
  private _needsResave = false
  private async saveNow(): Promise<void> {
    if (this._writing) {
      // 已有写入进行中,标记需要再次写盘;当前 write 完成后会在 do-while 里重写最新状态
      this._needsResave = true
      return
    }
    this._writing = true
    try {
      do {
        this._needsResave = false
        const json = JSON.stringify(this.settings, null, 2)
        const tmpPath = `${this.settingsPath}.tmp`
        // 确保目录存在
        await fsp.mkdir(path.dirname(this.settingsPath), { recursive: true })
        await fsp.writeFile(tmpPath, json, 'utf-8')
        await fsp.rename(tmpPath, this.settingsPath)
        this._lastError = null
      } while (this._needsResave)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._lastError = `Failed to save settings: ${msg}`
      console.error('[Settings] Save failed:', msg)
    } finally {
      this._writing = false
    }
  }

  /** 等待所有待写入完成（graceful shutdown） */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      await this.saveNow()
    }
    while (this._writing) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** 获取最近一次错误信息 */
  getLastError(): string | null {
    return this._lastError
  }

  /** 计算对象最大嵌套深度(防御恶意深嵌套对象) */
  private static _getObjectDepth(obj: unknown, seen = new WeakSet()): number {
    if (obj === null || typeof obj !== 'object') return 0
    if (seen.has(obj as object)) return 0 // 防止循环引用导致无限递归
    seen.add(obj as object)
    let maxDepth = 0
    try {
      for (const val of Object.values(obj as Record<string, unknown>)) {
        if (typeof val === 'object' && val !== null) {
          const d = SettingsService._getObjectDepth(val, seen)
          if (d > maxDepth) maxDepth = d
        }
      }
    } catch {
      // Object.values 在异常对象上可能抛错,忽略
      return 1
    }
    return maxDepth + 1
  }
}

export const settingsService = new SettingsService()
