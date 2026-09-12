// =============================================================
// settings/migrate-channels — feishu.* → channels.feishu.* 一次性迁移(M4)
//
// 规则(实施文档 §3.5):
//   1. 旧 settings.json 有 feishu.appId 而 channels.feishu.appId 为空
//      → 迁入 channels.feishu(appId/domain/enabled=true),旧字段保留(兼容读取)
//   2. 反向镜像:channels.feishu.appId 有值而旧 feishu.appId 为空
//      → 回写旧字段(出站集成 alerts/bitable/诊断仍读 feishu.*)
//   3. 迁移产生实际修改时,先备份 settings.json → settings.json.bak-channels-migration
//      (只备份一次,后续运行不再覆盖)
// 幂等:已是新结构时返回 false,不写盘。
// =============================================================

import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { UnifiedSettings } from '@shared/types'
import { log } from '../../utils/logger'

export const CHANNELS_MIGRATION_BACKUP_SUFFIX = '.bak-channels-migration'

/**
 * 就地执行迁移(修改传入的 settings 对象)。
 * @returns true = 有变更需要落盘
 */
export function migrateFeishuChannelSettings(settings: UnifiedSettings): boolean {
  const legacy = settings.feishu as { appId?: string; domain?: 'feishu' | 'lark' } | undefined
  const channel = settings.channels?.feishu
  if (!legacy || !channel) return false

  let changed = false

  // 旧 → 新:首次升级(旧 appId 存在,新 appId 仍为默认空)
  if (legacy.appId && !channel.appId) {
    channel.appId = legacy.appId
    channel.domain = legacy.domain === 'lark' ? 'lark' : 'feishu'
    channel.enabled = true
    changed = true
    log('info', 'settings', `migrated feishu.appId → channels.feishu.appId (${legacy.appId})`)
  }

  // 新 → 旧镜像:出站集成(教师推送/bitable/诊断)仍读 feishu.*,保持双写一致
  if (channel.appId && legacy.appId !== channel.appId) {
    legacy.appId = channel.appId
    legacy.domain = channel.domain
    changed = true
  } else if (channel.appId && legacy.domain !== channel.domain) {
    legacy.domain = channel.domain
    changed = true
  }

  return changed
}

/** 迁移前备份 settings.json(仅首次;失败不阻断启动,记日志) */
export function backupSettingsForMigration(settingsPath: string): void {
  const backupPath = `${settingsPath}${CHANNELS_MIGRATION_BACKUP_SUFFIX}`
  try {
    if (existsSync(backupPath)) return
    if (!existsSync(settingsPath)) return
    copyFileSync(settingsPath, backupPath)
    log(
      'info',
      'settings',
      `settings.json backed up before channels migration → ${path.basename(backupPath)}`,
    )
  } catch (err) {
    log('warn', 'settings', `settings backup failed (non-blocking): ${err}`)
  }
}
