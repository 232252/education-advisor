// =============================================================
// Backup Service — 全量数据备份/恢复
//
// 备份范围(白名单,逻辑名 → 运行时路径,兼容开发/打包两种模式):
//   settings.json        → {userData}/settings.json
//   eaa-data/**          → eaaBridge.getDataDir()/** (排除 .lock 锁文件)
//   workstation.db(-wal/-shm) → dbService.getDbPath()
//   cron-logs.jsonl      → {userData}/cron-logs.jsonl
//   cron.user.json       → {userData}/cron.user.json
//
// zip 内含 manifest.json(app 标识/版本/格式版本/文件清单),恢复时校验。
// 恢复流程: 校验 → 恢复前安全备份 → 关闭 db/EAA → 替换文件 → 要求重启。
// 自动备份: 每小时检查一次设置,间隔到期则备份到 {userData}/backups/,
//           超出保留份数自动清理最旧的。
// =============================================================

import type { Dirent } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { atomicWrite } from '../utils/atomic-write'
import { createZip, isSafeEntryName, readZipFile } from '../utils/zip'
import { dbService } from './db-service'
import { eaaBridge } from './eaa-bridge'
import { settingsService } from './settings-service'

const APP_ID = 'education-advisor'
const FORMAT_VERSION = 1
const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 每小时检查一次

export interface BackupManifest {
  app: string
  appVersion: string
  formatVersion: number
  createdAt: string
  files: Array<{ name: string; size: number }>
}

export interface AutoBackupInfo {
  fileName: string
  sizeBytes: number
  createdAt: number // epoch ms (文件 mtime)
  kind: 'auto' | 'pre-restore'
}

export interface CreateBackupResult {
  files: number
  bytes: number
}

interface LogicalFile {
  /** zip 内的相对路径(正斜杠) */
  name: string
  /** 磁盘绝对路径 */
  absPath: string
}

function backupsDir(): string {
  return path.join(app.getPath('userData'), 'backups')
}

/** 递归收集目录下所有文件(排除 .lock 等运行时锁文件),返回 [zipName, absPath] */
async function walkDir(dir: string, prefix: string, out: LogicalFile[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return // 目录不存在 → 跳过
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      await walkDir(abs, `${prefix}${e.name}/`, out)
    } else if (e.isFile()) {
      if (e.name === '.lock') continue // EAA 运行时锁,恢复时由启动流程重建
      out.push({ name: `${prefix}${e.name}`, absPath: abs })
    }
  }
}

/** 收集备份白名单文件(运行时实际路径) */
export async function collectBackupFiles(): Promise<LogicalFile[]> {
  const userData = app.getPath('userData')
  const files: LogicalFile[] = []

  files.push({ name: 'settings.json', absPath: path.join(userData, 'settings.json') })

  await walkDir(eaaBridge.getDataDir(), 'eaa-data/', files)

  const dbPath = dbService.getDbPath()
  if (dbPath) {
    files.push({ name: 'workstation.db', absPath: dbPath })
    // WAL/SHM 是 SQLite 热备份必需的伴随文件(可能不存在,打包时跳过)
    files.push({ name: 'workstation.db-wal', absPath: `${dbPath}-wal` })
    files.push({ name: 'workstation.db-shm', absPath: `${dbPath}-shm` })
  }

  files.push({ name: 'cron-logs.jsonl', absPath: path.join(userData, 'cron-logs.jsonl') })
  files.push({ name: 'cron.user.json', absPath: path.join(userData, 'cron.user.json') })

  return files
}

/** 打包当前核心数据为 zip 写到 destPath(原子写入) */
export async function createBackup(destPath: string): Promise<CreateBackupResult> {
  // settings 节流写盘 → 备份前 flush,确保 zip 里是最新设置
  await settingsService.flush().catch((err) => {
    console.warn('[Backup] settings flush before backup failed:', err)
  })

  const logical = await collectBackupFiles()
  const entries: Array<{ name: string; data: Buffer }> = []
  const manifestFiles: BackupManifest['files'] = []

  for (const f of logical) {
    let data: Buffer
    try {
      data = await fsp.readFile(f.absPath)
    } catch {
      continue // 文件不存在(如 -wal/-shm) → 跳过
    }
    entries.push({ name: f.name, data })
    manifestFiles.push({ name: f.name, size: data.length })
  }

  if (entries.length === 0) {
    throw new Error('no backupable data found (data directory empty?)')
  }

  const manifest: BackupManifest = {
    app: APP_ID,
    appVersion: app.getVersion(),
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    files: manifestFiles,
  }
  entries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'),
  })

  const zipBuf = createZip(entries)
  await atomicWrite(destPath, zipBuf)
  return { files: entries.length - 1, bytes: zipBuf.length }
}

/** 列出 {userData}/backups/ 下的备份(按时间倒序) */
export async function listAutoBackups(): Promise<AutoBackupInfo[]> {
  const dir = backupsDir()
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const infos: AutoBackupInfo[] = []
  for (const name of names) {
    if (!name.endsWith('.zip')) continue
    if (!isSafeEntryName(name)) continue
    try {
      const stat = await fsp.stat(path.join(dir, name))
      if (!stat.isFile()) continue
      infos.push({
        fileName: name,
        sizeBytes: stat.size,
        createdAt: stat.mtimeMs,
        kind: name.startsWith('pre-restore-') ? 'pre-restore' : 'auto',
      })
    } catch {}
  }
  infos.sort((a, b) => b.createdAt - a.createdAt)
  return infos
}

/** 删除 backups/ 下的一个备份文件(仅接受纯文件名,拒绝路径) */
export async function deleteAutoBackup(fileName: string): Promise<void> {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`invalid backup file name: ${fileName}`)
  }
  if (!fileName.endsWith('.zip')) throw new Error('not a backup zip')
  await fsp.unlink(path.join(backupsDir(), fileName))
}

/** 超出 keep 份数时清理最旧的备份 */
export async function pruneBackups(keep: number): Promise<number> {
  if (keep < 1) keep = 1
  const infos = await listAutoBackups()
  let removed = 0
  for (const info of infos.slice(keep)) {
    try {
      await deleteAutoBackup(info.fileName)
      removed++
    } catch {
      // 单个删除失败不阻塞
    }
  }
  return removed
}

/** 校验 manifest 合法性(拒绝非本应用的 zip) */
export function validateManifest(m: unknown): BackupManifest {
  if (typeof m !== 'object' || m === null) throw new Error('manifest missing or not an object')
  const man = m as Record<string, unknown>
  if (man.app !== APP_ID) throw new Error(`not an ${APP_ID} backup (app=${String(man.app)})`)
  if (man.formatVersion !== FORMAT_VERSION) {
    throw new Error(`unsupported backup format version: ${String(man.formatVersion)}`)
  }
  if (!Array.isArray(man.files)) throw new Error('manifest.files missing')
  return m as BackupManifest
}

/** zip 条目逻辑名 → 恢复目标绝对路径(白名单映射,未知条目拒绝) */
function mapEntryToTarget(name: string): string {
  const userData = app.getPath('userData')
  if (name.startsWith('eaa-data/')) {
    const rel = name.slice('eaa-data/'.length)
    if (!isSafeEntryName(rel)) throw new Error(`unsafe eaa-data entry: ${name}`)
    return path.join(eaaBridge.getDataDir(), ...rel.split('/'))
  }
  const dbPath = dbService.getDbPath()
  if (name === 'workstation.db') {
    if (!dbPath) throw new Error('workstation.db has no runtime path')
    return dbPath
  }
  if (name === 'workstation.db-wal' || name === 'workstation.db-shm') {
    if (!dbPath) throw new Error(`${name} has no runtime path`)
    return `${dbPath}${name.slice('workstation.db'.length)}`
  }
  if (name === 'settings.json' || name === 'cron-logs.jsonl' || name === 'cron.user.json') {
    return path.join(userData, name)
  }
  throw new Error(`unknown backup entry: ${name}`)
}

export interface RestoreResult {
  restoredFiles: number
  safetyBackupPath: string
}

/** 从 zip 恢复:校验 → 安全备份 → 关闭 db/EAA → 替换文件。成功后必须重启。 */
export async function restoreFromZip(zipPath: string): Promise<RestoreResult> {
  const entries = await readZipFile(zipPath)
  const manifestEntry = entries.find((e) => e.name === 'manifest.json')
  if (!manifestEntry) throw new Error('manifest.json not found in backup')
  try {
    validateManifest(JSON.parse(manifestEntry.data.toString('utf-8')))
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }

  // 1. 恢复前安全备份(即使 zip 本身有问题,当前数据已有兜底)
  await fsp.mkdir(backupsDir(), { recursive: true })
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  const safetyBackupPath = path.join(backupsDir(), `pre-restore-${stamp}.zip`)
  await createBackup(safetyBackupPath)

  // 2. 逐条目校验映射 + 对应数据(替换任何文件之前先全部校验,失败则零改动)
  const dataEntries = entries.filter((e) => e.name !== 'manifest.json')
  const targets = dataEntries.map((e) => ({
    name: e.name,
    data: e.data,
    target: mapEntryToTarget(e.name),
  }))

  // 3. 关闭数据持有者(Windows 上文件被占用会替换失败)
  await dbService.close()
  eaaBridge.shutdown()

  // 4. 替换文件
  for (const t of targets) {
    await fsp.mkdir(path.dirname(t.target), { recursive: true })
    await atomicWrite(t.target, t.data)
  }

  // 5. 清理恢复目录中多余的旧 eaa-data 文件?不做——保守策略:
  //    zip 覆盖同名文件,zip 中不存在的旧文件保留(避免误删用户数据)。
  //    恢复语义是"覆盖式合并",与整目录清空相比更安全。

  return { restoredFiles: entries.length - 1, safetyBackupPath }
}

// =============================================================
// 自动备份调度
// =============================================================

let autoTimer: ReturnType<typeof setInterval> | null = null
let autoRunning = false

/** 执行一次自动备份(供调度器与测试调用) */
export async function runAutoBackupOnce(): Promise<AutoBackupInfo | null> {
  if (autoRunning) return null
  autoRunning = true
  try {
    await fsp.mkdir(backupsDir(), { recursive: true })
    const ts = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
    const dest = path.join(backupsDir(), `auto-${stamp}.zip`)
    await createBackup(dest)
    settingsService.update('backup.lastAutoAt', Date.now())
    const keep = settingsService.getSettings().backup.keep ?? 7
    await pruneBackups(keep)
    const list = await listAutoBackups()
    return list.find((b) => b.fileName === path.basename(dest)) ?? null
  } finally {
    autoRunning = false
  }
}

/** 检查是否到期(纯函数,便于测试) */
export function isAutoBackupDue(lastAutoAt: number | undefined, intervalHours: number): boolean {
  if (!lastAutoAt || lastAutoAt <= 0) return true
  return Date.now() - lastAutoAt >= intervalHours * 3600_000
}

/** 启动自动备份调度(每小时检查一次设置) */
export function initAutoBackup(): void {
  if (autoTimer) return
  autoTimer = setInterval(() => {
    try {
      const s = settingsService.getSettings()
      if (!s.backup?.autoEnabled) return
      if (!isAutoBackupDue(s.backup.lastAutoAt, s.backup.intervalHours ?? 24)) return
      runAutoBackupOnce().catch((err) => {
        console.error('[Backup] auto backup failed:', err)
      })
    } catch (err) {
      console.error('[Backup] auto backup check failed:', err)
    }
  }, AUTO_CHECK_INTERVAL_MS)
  console.log('[Backup] auto backup scheduler started (check every hour)')
}

/** 停止自动备份调度 */
export function shutdownAutoBackup(): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
