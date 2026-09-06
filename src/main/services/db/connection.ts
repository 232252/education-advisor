// =============================================================
// DB Service — 数据库路径解析 / 连接打开 / pragma 配置
// 从 db-service.ts DBService.resolveDbPath / init 下沉
// (纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { errText } from '../../utils/err-text'
import { getAppPaths } from '../paths'

type BetterSqlite3 = typeof import('better-sqlite3')
type Database = import('better-sqlite3').Database

/**
 * 数据库路径 — R2-17 起统一经 path-resolver(getAppPaths().dbPath)。
 * 保留旧位置的迁移复制(开发态此前可能在 userData 有旧库),
 * 与 dev: 项目根 .app-data/workstation.db 同语义。
 *
 * @param mainDir 保留参数(兼容既有调用点;路径判定已收敛到 paths.ts)
 */
export function resolveDbPath(mainDir: string): string {
  void mainDir // R2-17: 判定逻辑已上移到 paths.ts,参数保留兼容
  const paths = getAppPaths()
  const legacyPath = path.join(app.getPath('userData'), 'workstation.db')

  if (legacyPath !== paths.dbPath && fs.existsSync(legacyPath) && !fs.existsSync(paths.dbPath)) {
    try {
      fs.mkdirSync(path.dirname(paths.dbPath), { recursive: true })
      fs.copyFileSync(legacyPath, paths.dbPath)
      for (const ext of ['-wal', '-shm']) {
        const src = legacyPath + ext
        if (fs.existsSync(src)) fs.copyFileSync(src, paths.dbPath + ext)
      }
      console.log(`[DB] Migrated DB from "${legacyPath}" to "${paths.dbPath}"`)
    } catch (err) {
      const msg = errText(err)
      console.warn('[DB] Migration failed, starting fresh:', msg)
    }
  }

  return paths.dbPath
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
