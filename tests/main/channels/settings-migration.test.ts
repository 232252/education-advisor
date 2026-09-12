// =============================================================
// M4: feishu.* → channels.feishu.* 设置迁移回归
// 幂等性 + 双向镜像 + 备份文件
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import { DEFAULT_SETTINGS } from '../../../src/main/services/settings/defaults'
import {
  backupSettingsForMigration,
  CHANNELS_MIGRATION_BACKUP_SUFFIX,
  migrateFeishuChannelSettings,
} from '../../../src/main/services/settings/migrate-channels'
import type { UnifiedSettings } from '@shared/types'

const VALID_APP_ID = `cli_${'b'.repeat(16)}`

function makeSettings(overrides: {
  legacyAppId?: string
  legacyDomain?: 'feishu' | 'lark'
  channelAppId?: string
}): UnifiedSettings {
  const s = structuredClone(DEFAULT_SETTINGS)
  s.feishu.appId = overrides.legacyAppId ?? ''
  if (overrides.legacyDomain) s.feishu.domain = overrides.legacyDomain
  if (overrides.channelAppId !== undefined) s.channels.feishu.appId = overrides.channelAppId
  return s
}

const tmpRoot = path.join(
  os.tmpdir(),
  `channels-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

beforeAll(async () => {
  await fsp.mkdir(tmpRoot, { recursive: true })
})

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
})

describe('migrateFeishuChannelSettings', () => {
  it('旧 feishu.appId 存在 → 迁入 channels.feishu(appId/domain/enabled),旧字段保留', () => {
    const s = makeSettings({ legacyAppId: VALID_APP_ID, legacyDomain: 'lark' })
    expect(migrateFeishuChannelSettings(s)).toBe(true)
    expect(s.channels.feishu.appId).toBe(VALID_APP_ID)
    expect(s.channels.feishu.domain).toBe('lark')
    expect(s.channels.feishu.enabled).toBe(true)
    // 出站集成兼容读取:旧字段保留
    expect(s.feishu.appId).toBe(VALID_APP_ID)
  })

  it('channels.feishu.appId 有值而旧字段为空 → 反向镜像回 feishu.*', () => {
    const s = makeSettings({ channelAppId: VALID_APP_ID })
    s.feishu.domain = 'feishu'
    s.channels.feishu.domain = 'lark'
    expect(migrateFeishuChannelSettings(s)).toBe(true)
    expect(s.feishu.appId).toBe(VALID_APP_ID)
    expect(s.feishu.domain).toBe('lark')
  })

  it('幂等:两边已一致 → 无变更', () => {
    const s = makeSettings({ legacyAppId: VALID_APP_ID })
    migrateFeishuChannelSettings(s)
    expect(migrateFeishuChannelSettings(s)).toBe(false)
  })

  it('全新安装(两边都空) → 无变更', () => {
    const s = makeSettings({})
    expect(migrateFeishuChannelSettings(s)).toBe(false)
  })
})

describe('backupSettingsForMigration', () => {
  it('首次备份生成 .bak 文件,再次调用不覆盖', async () => {
    const settingsPath = path.join(tmpRoot, 'settings.json')
    await fsp.writeFile(settingsPath, '{"feishu":{"appId":"x"}}', 'utf-8')
    backupSettingsForMigration(settingsPath)
    const backupPath = `${settingsPath}${CHANNELS_MIGRATION_BACKUP_SUFFIX}`
    await expect(fsp.access(backupPath)).resolves.toBeUndefined()
    // 覆写原文件后再备份 → 备份保持首份内容(不被覆盖)
    await fsp.writeFile(settingsPath, '{"feishu":{"appId":"changed"}}', 'utf-8')
    backupSettingsForMigration(settingsPath)
    const content = await fsp.readFile(backupPath, 'utf-8')
    expect(content).toContain('"x"')
  })

  it('原文件不存在 → 静默不生成备份', async () => {
    const settingsPath = path.join(tmpRoot, 'not-exist.json')
    backupSettingsForMigration(settingsPath)
    await expect(fsp.access(`${settingsPath}${CHANNELS_MIGRATION_BACKUP_SUFFIX}`)).rejects.toThrow()
  })
})
