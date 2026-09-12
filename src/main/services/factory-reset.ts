// =============================================================
// 出厂重置 — 清空班级/学生/对话/成绩/记忆/模型密钥/设置
// 成功后必须重启应用，渲染端还需清 localStorage 首用向导标记。
// 不删除 backups/ 与仓库旁的 .app-data.backup-* / .eaa-data.backup-*。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { emptyDir } from '../utils/empty-dir'
import { setLogLevel } from '../utils/logger'
import { invalidateClassContextCache } from './agent/class-context'
import { cronService } from './cron-service'
import { dbService } from './db-service'
import { ensureDataDirStructure } from './eaa/legacy-migration'
import { eaaBridge } from './eaa-bridge'
import { feishuBotService } from './channels/adapters/feishu/connection'
import { keystoreService } from './keystore-service'
import { getAppPaths, resolveAppDataDir } from './paths'
import { settingsService } from './settings-service'
import { syncNativeTheme } from './theme-service'
import { updateTray } from './tray-service'

/** 删除文件，不存在则忽略。 */
async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

/** 清空全部业务数据并恢复默认设置。调用方随后应 relaunch。 */
export async function factoryResetAll(): Promise<void> {
  await dbService.close()
  eaaBridge.shutdown()

  const paths = getAppPaths()
  await unlinkIfExists(paths.dbPath)
  await unlinkIfExists(`${paths.dbPath}-wal`)
  await unlinkIfExists(`${paths.dbPath}-shm`)

  await emptyDir(paths.eaaDataDir)
  const schemaDir = path.join(path.dirname(paths.eaaDataDir), 'schema')
  ensureDataDirStructure(paths.eaaDataDir, schemaDir)

  await emptyDir(paths.academicsDir)
  await emptyDir(paths.gradingDir)
  await emptyDir(paths.profilesDir)
  await emptyDir(paths.memoryDir)
  await emptyDir(paths.userSkillsDir)
  await emptyDir(path.join(resolveAppDataDir(), 'webui-uploads'))

  const userData = app.getPath('userData')
  await unlinkIfExists(path.join(userData, 'cron.user.json'))
  await unlinkIfExists(path.join(userData, 'cron-logs.jsonl'))

  settingsService.reset()
  await settingsService.flush()

  await keystoreService.ready()
  await keystoreService.clearAll()

  invalidateClassContextCache()

  await feishuBotService.stop().catch(() => {})
  // 阶段 2: 钉钉频道一并停止(keystore 已 clearAll,凭证同时清空)
  const { dingtalkBotService } = await import('./channels/adapters/dingtalk/connection')
  await dingtalkBotService.stop().catch(() => {})
  // 阶段 3: 企微频道同上
  const { wecomBotService } = await import('./channels/adapters/wecom/connection')
  await wecomBotService.stop().catch(() => {})
  app.setLoginItemSettings({ openAtLogin: false })
  const newSettings = settingsService.getSettings()
  updateTray(newSettings.general.minimizeToTray)
  setLogLevel(newSettings.general.logLevel)
  syncNativeTheme()
  cronService.registerBitableSync()
  cronService.registerAutoBackup()
}
