// =============================================================
// 统一路径解析器(R2-17)
//
// 背景: F-05 严重级 — 此前 4 套并行解析且互不一致:
//   EAA(legacy-migration): dev→<root>/.eaa-data; SQLite(connection):
//   dev→<root>/.app-data; academic/profile: 硬编码 userData/eaa-data{academics,profiles}
//   (无 dev 重定向) → 开发时数据写入 A、读取 B,同名数据双份,
//   备份可能打包旧副本(会丢数据的架构债)。
//
// 目标布局(唯一事实来源,全部消费方都必须经本模块取路径):
//   dev:  <root>/.app-data/{workstation.db,academics,profiles,skills,memory}
//         <root>/.eaa-data            ← 仅 Rust CLI 领地(entities/events/privacy)
//   prod: <userData>/{workstation.db,academics,profiles,skills,memory}
//         <userData>/eaa-data/       ← 仅 Rust CLI 领地
// 规则:
//   1. 应用自有数据(学业/档案/技能/记忆)一律与 SQLite 同层(appDataDir)
//   2. Rust 领地只留 Rust 的东西(eaaDataDir 保留 EAA_DATA_DIR env 覆盖)
//   3. settings.general.dataDir 是「当前 EAA 数据目录」的展示镜像
//      (settings-service 启动时自动填默认值),**不是**用户输入——
//      解析器一律不消费它,避免"显示字段"与"配置字段"语义混用
//   4. 一次性迁移: 旧位置 userData/eaa-data/{academics,profiles} → 新位置
//      (幂等,成功后在 appDataDir 写 .r2-path-migrated 标记)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** 开发/打包三态判定统一入口(取代各模块的 process.resourcesPath 检测复制) */
export function isDevRuntime(): boolean {
  const resourcesPath = process.resourcesPath || ''
  return resourcesPath.includes('node_modules') || resourcesPath.includes('electron')
}

/** 项目根(paths.ts 位于 dist/main/services/ → 上两级) */
function projectRoot(): string {
  return path.resolve(__dirname, '..', '..')
}

/**
 * 随应用分发的只读资源目录(agents/config/skills 等)统一解析。
 * dev: 项目根下存在该目录则用之;否则回退 packaged resources。
 * 判据用 existsSync 而非 isDevRuntime — app.isPackaged/isDevRuntime
 * 在 `electron .` 启动时不可靠,dev 目录存在性检查更稳(各模块原判据)。
 */
export function resolveResourceDir(rel: string): string {
  const devDir = path.join(projectRoot(), rel)
  return fs.existsSync(devDir) ? devDir : path.join(process.resourcesPath || '', rel)
}

/** 应用自有数据根目录(SQLite / academics / profiles / skills / memory 同层) */
export function resolveAppDataDir(): string {
  if (isDevRuntime()) return path.join(projectRoot(), '.app-data')
  return app.getPath('userData')
}

/** Rust eaa-cli 数据领地(env 覆盖最高优先;dev 落项目根) */
export function resolveEaaDataDir(): string {
  const envOverride = process.env.EAA_DATA_DIR
  if (envOverride && envOverride.trim().length > 0) return envOverride.trim()
  if (isDevRuntime()) return path.join(projectRoot(), '.eaa-data')
  return path.join(app.getPath('userData'), 'eaa-data')
}

interface AppPaths {
  /** 应用数据根(.app-data / userData / 自定义) */
  appDataDir: string
  /** SQLite 数据库 */
  dbPath: string
  /** 学业成绩 JSON */
  academicsDir: string
  /** 学生扩展档案 */
  profilesDir: string
  /** 用户技能 */
  userSkillsDir: string
  /** agent 长期记忆 */
  memoryDir: string
  /** Rust eaa-cli 领地 */
  eaaDataDir: string
}

let cachedPaths: AppPaths | null = null

/** 获取统一路径(缓存;迁移在首次解析时执行一次) */
export function getAppPaths(): AppPaths {
  if (cachedPaths) return cachedPaths
  const appDataDir = resolveAppDataDir()
  const paths: AppPaths = {
    appDataDir,
    dbPath: path.join(appDataDir, 'workstation.db'),
    academicsDir: path.join(appDataDir, 'academics'),
    profilesDir: path.join(appDataDir, 'profiles'),
    userSkillsDir: path.join(appDataDir, 'skills'),
    memoryDir: path.join(appDataDir, 'memory'),
    eaaDataDir: resolveEaaDataDir(),
  }
  runLegacyPathMigration(paths)
  cachedPaths = paths
  return paths
}

/** 测试用:重置缓存 */
export function resetAppPathsCache(): void {
  cachedPaths = null
}

/**
 * 一次性迁移(幂等): 旧位置 {userData}/eaa-data/{academics,profiles}
 * (academic/profile 早期硬编码路径,后来 R154 迁移把旧目录复制过 .eaa-data)
 * → 新位置 appDataDir/{academics,profiles}。
 * 只在新位置不存在时移动目录(存在=已是新局面,不动);
 * 已完成标记写在 appDataDir/.r2-path-migrated。
 */
function runLegacyPathMigration(paths: AppPaths): void {
  const marker = path.join(paths.appDataDir, '.r2-path-migrated')
  if (fs.existsSync(marker)) return
  const legacyBase = path.join(app.getPath('userData'), 'eaa-data')
  try {
    let moved = false
    for (const sub of ['academics', 'profiles'] as const) {
      const oldDir = path.join(legacyBase, sub)
      const newDir = paths[sub === 'academics' ? 'academicsDir' : 'profilesDir']
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.mkdirSync(path.dirname(newDir), { recursive: true })
        try {
          fs.renameSync(oldDir, newDir)
        } catch (err) {
          // EXDEV 修复(2026-09-04): userData 与项目数据目录可能跨挂载点(如 /home vs /mnt),
          // rename 跨设备必然失败且"下次重试"永远重试 — 退化为复制+删除,迁移真正完成
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
          try {
            fs.cpSync(oldDir, newDir, { recursive: true })
            fs.rmSync(oldDir, { recursive: true, force: true })
          } catch (cpErr) {
            // 复制中断则清掉半成品,保证下次启动重试时 newDir 不存在
            fs.rmSync(newDir, { recursive: true, force: true })
            throw cpErr
          }
        }
        moved = true
        console.log(`[paths] R2-17 migrated ${sub}: "${oldDir}" → "${newDir}"`)
      }
    }
    if (moved) fs.mkdirSync(paths.appDataDir, { recursive: true })
    fs.writeFileSync(marker, Date.now().toString(), 'utf-8')
  } catch (err) {
    // 迁移失败不阻断启动:下次启动会重试(幂等)
    console.warn('[paths] R2-17 legacy migration skipped (will retry next start):', err)
  }
}
