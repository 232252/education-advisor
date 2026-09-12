// =============================================================
// channels/manager — ChannelManager(主进程单例,M4)
// 注册表 + 启停编排 + 状态聚合 + 设置/keystore → ctx 组装。
//
// 静态注册表起步(无动态加载):register(factory) 在应用启动时调用;
// 每渠道单实例(D1),多实例(instanceId)留待真实需求再开。
// 状态五态派生(configured/enabled 从 settings+keystore,运行态从 adapter);
// adapter 经 ctx.bridge.onStatus 上报 → Manager 聚合处理/排队计数后
// emit('status', ChannelStatusInfo) → channel-handlers fanout 渲染层+WebUI。
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import type {
  ChannelInstanceInfo,
  ChannelManifest,
  ChannelRunStatus,
  ChannelStatusInfo,
} from '@shared/types'
import { app } from 'electron'
import { log } from '../../utils/logger'
import { keystoreService } from '../keystore-service'
import { settingsService } from '../settings-service'
import { validateManifest } from './manifest'
import type { ChannelAdapter, ChannelRuntimeContext } from './types'

/**
 * 各渠道 secret 字段 → keystore 键。
 * 飞书沿用历史键 'feishu-app-secret'(已部署用户的密钥不迁移,零重配)。
 * 新渠道默认 `${id}-${kebab(name)}`。
 */
const SECRET_KEY_OVERRIDES: Record<string, Record<string, string>> = {
  feishu: { appSecret: 'feishu-app-secret' },
}

function keystoreKeyFor(channelId: string, fieldName: string): string {
  const override = SECRET_KEY_OVERRIDES[channelId]?.[fieldName]
  if (override) return override
  const kebab = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return `${channelId}-${kebab}`
}

class ChannelManager extends EventEmitter {
  /** 渠道工厂注册表(id → factory) */
  private factories = new Map<string, () => ChannelAdapter>()
  /** adapter 实例缓存(每渠道单实例) */
  private adapters = new Map<string, ChannelAdapter>()
  /** 仅注册 manifest 的占位渠道(comingSoon,UI 可见不可连) */
  private pendingManifests = new Map<string, ChannelManifest>()
  private win: import('electron').BrowserWindow | null = null

  constructor() {
    super()
    this.setMaxListeners(30)
  }

  /** 注册渠道(应用启动时调用);manifest 非法时记日志拒注册 */
  register(factory: () => ChannelAdapter): void {
    const adapter = factory()
    const problems = validateManifest(adapter.manifest)
    if (problems.length > 0) {
      log(
        'error',
        'channels',
        `manifest invalid, refuse to register '${adapter.id}': ${problems.join('; ')}`,
      )
      return
    }
    if (adapter.manifest.comingSoon) {
      this.pendingManifests.set(adapter.manifest.id, adapter.manifest)
      return
    }
    this.factories.set(adapter.id, factory)
    this.adapters.set(adapter.id, adapter)
    log('info', 'channels', `registered channel '${adapter.id}' (${adapter.manifest.label})`)
  }

  /** 注册占位渠道(即将支持,无实现) */
  registerManifest(manifest: ChannelManifest): void {
    this.pendingManifests.set(manifest.id, manifest)
  }

  /** 主窗口引用(ctx.getWin / Agent 状态推送目标) */
  setWindow(win: import('electron').BrowserWindow | null): void {
    this.win = win
  }

  getAdapter(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id)
  }

  /** 所有已注册 manifest(含 comingSoon 占位)— UI 渠道目录数据源 */
  listManifests(): ChannelManifest[] {
    return [
      ...Array.from(this.adapters.values()).map((a) => a.manifest),
      ...this.pendingManifests.values(),
    ]
  }

  /** 渠道是否已配置(manifest 必填字段在 settings 且 keystore 有 secret) */
  isConfigured(id: string): boolean {
    const adapter = this.adapters.get(id)
    if (!adapter) return false
    const channelSettings = this.readChannelSettings(id)
    if (!channelSettings) return false
    for (const field of adapter.manifest.configSchema) {
      if (!field.required) continue
      if (field.type === 'secret') {
        if (!keystoreService.getSecret(keystoreKeyFor(id, field.name))) return false
      } else {
        const v = channelSettings[field.name]
        if (typeof v !== 'string' || !v.trim()) return false
      }
    }
    return true
  }

  /** 渠道启用开关(settings.channels.<id>.enabled,缺省 true) */
  isEnabled(id: string): boolean {
    const channelSettings = this.readChannelSettings(id)
    const enabled = channelSettings?.enabled
    return typeof enabled === 'boolean' ? enabled : true
  }

  /** 渠道实例列表(channels:list IPC 源)— 五态派生 */
  list(): ChannelInstanceInfo[] {
    const out: ChannelInstanceInfo[] = []
    for (const adapter of this.adapters.values()) {
      out.push({
        manifest: adapter.manifest,
        configured: this.isConfigured(adapter.id),
        enabled: this.isEnabled(adapter.id),
        status: this.deriveStatus(adapter.id),
      })
    }
    // 占位渠道(即将支持)
    for (const manifest of this.pendingManifests.values()) {
      out.push({
        manifest,
        configured: false,
        enabled: false,
        status: {
          channel: manifest.id,
          status: 'not-configured',
          processingCount: 0,
          pendingCount: 0,
        },
      })
    }
    return out
  }

  /** 组装运行时上下文(settings 非 secret 字段 + keystore secret 读取器) */
  buildContext(id: string): ChannelRuntimeContext {
    return {
      config: { ...(this.readChannelSettings(id) ?? {}) },
      getSecret: async (name) => keystoreService.getSecret(keystoreKeyFor(id, name)) || null,
      bridge: {
        onMessage: (msg) => {
          // v1: 飞书引擎(自含 pipeline)不经此入口;外部归一化型适配器(钉钉 v2)使用
          log(
            'debug',
            'channels',
            `[${id}] inbound message ${msg.providerMessageId} (bridge.onMessage)`,
          )
        },
        onStatus: (partial) => this.applyAdapterStatus(id, partial),
      },
      filesDir: this.channelFilesDir(id),
      getWin: () => this.win,
    }
  }

  /** 启动渠道(app-lifecycle 自启 / UI 手动连接) */
  async start(id: string): Promise<void> {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`未知渠道: ${id}`)
    if (!this.isConfigured(id)) {
      throw new Error('渠道未配置完整(缺必填凭证),请先在连接中心完成配置')
    }
    log('info', 'channels', `starting channel '${id}'`)
    await adapter.connect(this.buildContext(id))
  }

  /** 停止渠道(排空收尾由 adapter.disconnect 负责) */
  async stop(id: string, opts?: { userInitiated?: boolean }): Promise<void> {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`未知渠道: ${id}`)
    log(
      'info',
      'channels',
      `stopping channel '${id}' (userInitiated=${opts?.userInitiated !== false})`,
    )
    await adapter.disconnect(opts)
  }

  /** 测试连接 = validateConfig + 不建长连接 */
  async test(id: string): Promise<{ ok: boolean; message: string; field?: string }> {
    const adapter = this.adapters.get(id)
    if (!adapter) return { ok: false, message: `未知渠道: ${id}` }
    const result = await adapter.validateConfig(this.buildContext(id))
    return result.ok ? { ok: true, message: '凭证有效' } : result
  }

  /** 开机自启:已配置且开关打开的渠道逐个启动(失败不阻断其他) */
  async autoStart(): Promise<void> {
    for (const id of this.factories.keys()) {
      if (!this.isConfigured(id) || !this.isEnabled(id)) continue
      try {
        await this.start(id)
      } catch (err) {
        log(
          'warn',
          'channels',
          `autoStart '${id}' failed: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
  }

  /** 五态派生:not-configured / disabled / 运行态(adapter)。纯计算,不广播。 */
  private deriveStatus(id: string): ChannelStatusInfo {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      return { channel: id, status: 'not-configured', processingCount: 0, pendingCount: 0 }
    }
    if (!this.isConfigured(id)) {
      return { channel: id, status: 'not-configured', processingCount: 0, pendingCount: 0 }
    }
    if (!this.isEnabled(id)) {
      return { channel: id, status: 'disabled', processingCount: 0, pendingCount: 0 }
    }
    const base = adapter.getStatus()
    const stats = adapter.getStats?.() ?? { processingCount: 0, pendingCount: 0 }
    return {
      channel: id,
      status: base.status,
      detail: base.detail,
      connectedAt: base.connectedAt,
      processingCount: stats.processingCount,
      pendingCount: stats.pendingCount,
    }
  }

  /** adapter 上报的连接层状态 → 聚合计数 → 广播 */
  private applyAdapterStatus(
    id: string,
    partial: Omit<ChannelStatusInfo, 'channel' | 'processingCount' | 'pendingCount'>,
  ): void {
    const adapter = this.adapters.get(id)
    if (!adapter) return
    const stats = adapter.getStats?.() ?? { processingCount: 0, pendingCount: 0 }
    const info: ChannelStatusInfo = {
      channel: id,
      ...partial,
      processingCount: stats.processingCount,
      pendingCount: stats.pendingCount,
    }
    try {
      this.emit('status', info)
    } catch (err) {
      log('warn', 'channels', `status listener error: ${err}`)
    }
  }

  /** settings.channels.<id> 的原始字段(secret 字段无效,真实值在 keystore) */
  private readChannelSettings(id: string): Record<string, unknown> | undefined {
    const settings = settingsService.getSettings() as unknown as Record<string, unknown>
    const channels = settings.channels as Record<string, Record<string, unknown>> | undefined
    return channels?.[id]
  }

  /** 渠道专属文件目录 */
  private channelFilesDir(id: string): string {
    try {
      return path.join(app.getPath('userData'), 'channels', id, 'files')
    } catch {
      return path.join(process.env.TEMP ?? process.env.TMP ?? '.', 'channels', id, 'files')
    }
  }
}

export const channelManager = new ChannelManager()
export type { ChannelRunStatus }
