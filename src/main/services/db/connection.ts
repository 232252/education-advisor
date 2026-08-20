// =============================================================
// DB Service — 数据库路径解析 / 连接打开 / pragma 配置
// 从 db-service.ts DBService.resolveDbPath / init 下沉
// (纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

type BetterSqlite3 = typeof import('better-sqlite3')
type Database = import('better-sqlite3').Database

/**
 * R155 修复: 开发模式下 TRAE Sandbox 阻止写入 %APPDATA%,
 * 导致 SQLite 初始化失败、chat 持久化/agent 历史/cron 日志全部静默 no-op。
 * 与 eaa-bridge.resolveDataDir() 同模式: 开发模式重定向到项目根 .app-data/。
 *
 * @param mainDir 主进程模块目录(db-service.ts 的 __dirname,用于定位项目根;
 *               在编排层求值后传入,保证与下沉前 __dirname 的语义一致)
 */
export function resolveDbPath(mainDir: string): string {
  const userData = app.getPath('userData')
  const legacyPath = path.join(userData, 'workstation.db')
  const resourcesPath = process.resourcesPath || ''
  const isRealPackaged =
    !resourcesPath.includes('node_modules') && !resourcesPath.includes('electron')

  if (isRealPackaged) {
    return legacyPath
  }

  // 开发模式: 项目根 .app-data/workstation.db
  const projectRoot = path.resolve(mainDir, '..', '..')
  const devDir = path.join(projectRoot, '.app-data')
  const devPath = path.join(devDir, 'workstation.db')

  // 迁移旧数据(如果存在且新路径不存在)
  if (fs.existsSync(legacyPath) && !fs.existsSync(devPath)) {
    try {
      fs.mkdirSync(devDir, { recursive: true })
      fs.copyFileSync(legacyPath, devPath)
      // WAL/SHM 临时文件也尝试迁移(可能不存在)
      for (const ext of ['-wal', '-shm']) {
        const src = legacyPath + ext
        if (fs.existsSync(src)) fs.copyFileSync(src, devPath + ext)
      }
      console.log(`[DB] R155: Migrated DB from "${legacyPath}" to "${devPath}"`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[DB] R155: Migration failed, starting fresh:', msg)
    }
  }

  return devPath
}

/**
 * 打开 SQLite 数据库并应用 pragma 配置
 * (提取自 DBService.init,逻辑逐字保留)。
 *
 * better-sqlite3 是 native 模块,可能加载失败（重新编译失败/平台不支持）,
 * 用 require 而非 import,让调用方的 try/catch 包裹更干净;
 * 加载/打开失败时抛错,由编排层降级为 no-op 模式。
 */
export function openDatabase(dbPath: string): Database {
  // 动态 require,允许失败降级
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3: BetterSqlite3 = require('better-sqlite3')
  const db = new BetterSqlite3(dbPath)
  // WAL 模式提升并发读性能
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  return db
}
