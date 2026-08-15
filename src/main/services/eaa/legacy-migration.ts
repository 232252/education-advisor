// =============================================================
// EAA Bridge — 数据目录解析 / legacy 迁移 / stale lock 清理
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * R152 修复 + R135 强化: 清理 stale .lock 文件
 * EAA Rust CLI 通过 .lock 文件做进程互斥,进程崩溃后 lock 残留
 * 导致后续需要 cache 的命令(list-students/score/ranking 等)报
 * "IO error: 拒绝访问 (os error 5)" (Windows ERROR_ACCESS_DENIED)
 *
 * R135 修正: 阈值从 60s 降到 5s
 *   - EAA 是 spawn-per-command,单次执行通常 < 1s(参见 EAA_BRIDGE.md 性能章节)
 *   - 60s 阈值远大于实际执行时间,stale lock 永远不会被清理
 *   - 5s 阈值留 5x 余量,既能清理 stale lock,又不会误删活动 lock
 *
 * @param dataDir EAA 数据目录
 * @returns true 表示已清理 stale lock
 */
export function cleanupStaleLock(dataDir: string): boolean {
  const lockPath = path.join(dataDir, '.lock')
  try {
    if (!fs.existsSync(lockPath)) return false
    const stat = fs.statSync(lockPath)
    const ageMs = Date.now() - stat.mtimeMs
    // 5 秒阈值: EAA 单次执行 < 1s,5s 余量足够
    if (ageMs < 5_000) {
      // 锁文件很新,可能是另一个 EAA 进程正在运行,不删除
      return false
    }
    fs.unlinkSync(lockPath)
    console.warn(
      `[EAA] Cleaned stale .lock file (age=${Math.round(ageMs / 1000)}s, mtime=${stat.mtime.toISOString()})`,
    )
    return true
  } catch (err) {
    // 删除失败不阻塞,记录后继续(EAA 命令本身会报更详细的错误)
    console.warn(
      '[EAA] Failed to cleanup stale .lock:',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

/**
 * R154 修复: 解析 EAA 数据目录路径。
 *
 * **背景**: TRAE Sandbox 拦截 `%APPDATA%/Education Advisor/eaa-data/.lock` 写入,
 * 导致 EAA 子进程所有需要 cache 的读命令(stats/list-students/ranking 等)报
 * "IO error: 拒绝访问 (os error 5)"。doctor 命令不写 .lock 所以能成功。
 *
 * **方案**:
 * - **真正打包模式** (process.resourcesPath 不含 node_modules/electron):
 *   用 `app.getPath('userData')/eaa-data`(生产环境无沙箱限制)
 * - **开发模式** (npx electron . 或 electron .): 优先用项目目录下的 `.eaa-data`
 *   (TRAE 沙箱 allowlist 包含项目根目录)
 *   - 如果新位置不存在但旧位置有数据,自动迁移(递归复制)
 *   - 如果新位置已存在,直接用
 *   - schema 目录在 dataDir 父目录下,initialize() 会自动创建并填充
 *
 * **注意**: `app.isPackaged` 在用 `electron .` 启动时不可靠(可能返回 true),
 * 参见 agent-service.ts:102 的同样问题。这里用 process.resourcesPath 判断更可靠。
 *
 * **数据迁移**: 一次性,迁移后旧位置保留(用户可手动清理)。
 * 迁移失败不阻塞,记录后继续(会用空目录,EAA 会重建)。
 *
 * @param mainDir 主进程模块目录(eaa-bridge.ts 的 __dirname,用于定位项目根;
 *               在编排层求值后传入,保证与拆分前 __dirname 的语义一致)
 */
export function resolveDataDir(mainDir: string): string {
  // 开发/测试/CI 覆盖入口: 若设置了 EAA_DATA_DIR 环境变量,直接使用该目录。
  // 用于在不修改代码的情况下切换数据目录(如沙箱权限受限时指向可写位置)。
  // 生产环境通常不设置此变量,走下方常规解析。
  const envOverride = process.env.EAA_DATA_DIR
  if (envOverride && envOverride.trim().length > 0) {
    try {
      fs.mkdirSync(envOverride, { recursive: true })
      return envOverride
    } catch (err) {
      console.warn(
        `[EAA] EAA_DATA_DIR override failed (${envOverride}): ${err}, falling back to default`,
      )
    }
  }

  const legacyDir = path.join(app.getPath('userData'), 'eaa-data')

  // 检测是否为真正打包模式(process.resourcesPath 不含 node_modules/electron)
  // 开发模式下 process.resourcesPath 类似:
  //   C:\...\node_modules\electron\dist\resources
  // 打包模式下 process.resourcesPath 类似:
  //   C:\Users\...\AppData\Local\Programs\Education Advisor\resources
  const resourcesPath = process.resourcesPath || ''
  const isRealPackaged =
    !resourcesPath.includes('node_modules') && !resourcesPath.includes('electron')

  // 真正打包模式: 用 userData/eaa-data(生产环境无沙箱限制)
  if (isRealPackaged) {
    return legacyDir
  }

  // 开发模式: 用项目目录下的 .eaa-data
  // mainDir 在编译后是 dist/main/,项目根是上两级
  const projectRoot = path.resolve(mainDir, '..', '..')
  const devDir = path.join(projectRoot, '.eaa-data')

  // 如果 devDir 已存在且有 entities 子目录,直接用(已迁移过)
  if (fs.existsSync(devDir) && fs.existsSync(path.join(devDir, 'entities'))) {
    return devDir
  }

  // devDir 不存在或为空,检查是否需要从 legacyDir 迁移
  if (fs.existsSync(legacyDir) && fs.existsSync(path.join(legacyDir, 'entities'))) {
    try {
      console.log(
        `[EAA] R154: Migrating data from "${legacyDir}" to "${devDir}" (TRAE sandbox workaround)`,
      )
      fs.mkdirSync(devDir, { recursive: true })
      // 递归复制 legacyDir → devDir
      const copyDir = (src: string, dst: string) => {
        if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name)
          const d = path.join(dst, entry.name)
          if (entry.isDirectory()) {
            copyDir(s, d)
          } else if (entry.isFile()) {
            // 跳过 .lock 文件(可能是 stale lock)
            if (entry.name === '.lock') continue
            fs.copyFileSync(s, d)
          }
        }
      }
      copyDir(legacyDir, devDir)
      console.log('[EAA] R154: Migration completed')

      // R139 修复: 同时迁移 schema 目录。
      // EAA Rust CLI get_schema_dir() 在 dataDir 的**父目录**中寻找 schema/reason_codes.json,
      // 因此 schema 与 dataDir 是兄弟关系,不在 dataDir 内部,不会被上面的 copyDir 复制。
      // - legacy dataDir:  %APPDATA%/Education Advisor/eaa-data
      // - legacy schema:   %APPDATA%/Education Advisor/schema
      // - dev dataDir:     <projectRoot>/.eaa-data
      // - dev schema 需求: <projectRoot>/schema
      const legacySchemaDir = path.join(path.dirname(legacyDir), 'schema')
      const devSchemaDir = path.join(projectRoot, 'schema')
      if (
        fs.existsSync(legacySchemaDir) &&
        fs.existsSync(path.join(legacySchemaDir, 'reason_codes.json')) &&
        !fs.existsSync(path.join(devSchemaDir, 'reason_codes.json'))
      ) {
        try {
          if (!fs.existsSync(devSchemaDir)) fs.mkdirSync(devSchemaDir, { recursive: true })
          copyDir(legacySchemaDir, devSchemaDir)
          console.log(`[EAA] R139: Migrated schema from "${legacySchemaDir}" to "${devSchemaDir}"`)
        } catch (schemaErr) {
          // schema 迁移失败不阻塞,initialize() 会从 config/reason-codes.json 重建
          const msg = schemaErr instanceof Error ? schemaErr.message : String(schemaErr)
          console.warn('[EAA] R139: Schema migration failed (will retry in initialize()):', msg)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[EAA] R154: Migration failed, using empty dir:', msg)
    }
  }

  return devDir
}

/**
 * 确保 EAA 数据目录及内部结构存在(提取自 EAABridge.initialize,逻辑逐字保留)。
 * 失败时抛错,由调用方(编排层)决定降级策略。
 *
 * @param dataDir EAA 数据目录
 * @param schemaDir schema 目录(dataDir 父目录下的 schema/)
 */
export function ensureDataDirStructure(dataDir: string, schemaDir: string): void {
  // 确保数据目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // 确保内部子目录结构存在（EAA Rust CLI 要求的固定布局）
  const subDirs = ['entities', 'events', 'logs']
  for (const sub of subDirs) {
    const subPath = path.join(dataDir, sub)
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true })
    }
  }

  // 确保核心数据文件存在（空结构）
  const entitiesPath = path.join(dataDir, 'entities', 'entities.json')
  if (!fs.existsSync(entitiesPath)) {
    const emptyEntities = JSON.stringify(
      {
        version: '1.0',
        base_score: 100.0,
        entities: {},
      },
      null,
      2,
    )
    fs.writeFileSync(entitiesPath, emptyEntities, 'utf-8')
    console.log('[EAA] Created empty entities/entities.json')
  }

  const eventsPath = path.join(dataDir, 'events', 'events.json')
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '[]', 'utf-8')
    console.log('[EAA] Created empty events/events.json')
  }

  const nameIndexPath = path.join(dataDir, 'entities', 'name_index.json')
  if (!fs.existsSync(nameIndexPath)) {
    fs.writeFileSync(nameIndexPath, '{}', 'utf-8')
    console.log('[EAA] Created empty entities/name_index.json')
  }

  // 确保 reason-codes 配置文件存在
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true })
  }

  // R152 修复: 清理 stale .lock 文件
  // EAA Rust CLI 通过 .lock 文件做进程互斥,进程崩溃后 lock 残留
  // 导致后续所有需要 cache 的命令(list-students/score/ranking/rebuild-cache)
  // 报 "IO error: 拒绝访问 (os error 5)" (Windows ERROR_ACCESS_DENIED)
  // EAA 进程是短生命周期的(spawn per command),初始化时不应有进程持有锁
  cleanupStaleLock(dataDir)
}

/**
 * 转换 reason-codes.json (P-fix: project flat schema -> Rust nested schema)
 * 项目根 config/reason-codes.json 是 flat 格式: { CODE: { label, category, delta } }
 * Rust EAA CLI 期望嵌套格式: { version, codes: { CODE: { label, category, score_delta } } }
 * 转换: 读源 JSON -> 包装成 { version, codes: {...} }
 * (提取自 EAABridge.initialize 内局部函数,逻辑逐字保留)
 */
export function convertReasonCodes(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const pAny = parsed as { codes?: unknown; version?: unknown }
    if (pAny.codes && typeof pAny.codes === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
    const out: {
      version: string
      codes: Record<string, { label: string; category: string; score_delta: number }>
    } = { version: '1.0', codes: {} }
    for (const [code, defAny] of Object.entries(parsed)) {
      const def = defAny as {
        label?: unknown
        category?: unknown
        delta?: unknown
        score_delta?: unknown
      }
      if (!def || typeof def !== 'object') continue
      out.codes[code] = {
        label: typeof def.label === 'string' ? def.label : code,
        category: typeof def.category === 'string' ? def.category : 'deduct',
        score_delta:
          typeof def.score_delta === 'number'
            ? def.score_delta
            : typeof def.delta === 'number'
              ? def.delta
              : 0,
      }
    }
    return JSON.stringify(out, null, 2)
  } catch {
    return raw
  }
}
