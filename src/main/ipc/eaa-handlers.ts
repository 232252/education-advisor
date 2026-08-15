// =============================================================
// EAA 核心 IPC 处理器 — 注册入口与共享缓存编排
// 完整覆盖 EAA CLI 全部 21 个子命令
// - 参数 sanitize 防止命令注入（P1-14）— 已抽到 ./eaa-sanitize
// - 危险操作二次确认（P1-15）
// - query 复合参数引号支持（P1-16）
// - 原因码查找已抽到 ./eaa-reason-codes(消除重复缓存)
// - 缓存使用 TtlLruCache(替代手写 Map+TTL+LRU,行为逐字节等价)
//   staticCache/scoreCache 创建在 ./eaa/cache.ts;
//   studentsCache/rankingCache 与 invalidateStudentsCache 保留在本文件
//   (tests/e2e 的源码断言依赖这些标识符出现在本文件内容中)
// - ranking/summary 性能优化:EAA CLI v3.1.4+ 已返回 class_id,
//   不再需要额外 spawn list-students(~2600ms 节省)
// - scoreCache 预填充:ranking 数据预热,后续 score 调用 95ms → 0.2ms
// 重构: 各域 handler 拆分到 ./eaa/ 子目录(参数组装见 eaa/commands.ts)
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, ipcMain } from 'electron'
import { eaaBridge } from '../services/eaa-bridge'
import { createEaaCacheContext } from './eaa/cache'
import { prefillScoreCacheFromRanking } from './eaa/commands'
import { registerEventHandlers } from './eaa/handlers-events'
import { registerExportHandlers } from './eaa/handlers-export'
import { registerStudentHandlers } from './eaa/handlers-students'
import { registerSystemHandlers } from './eaa/handlers-system'

/**
 * 供 class-handlers 等其他模块调用,使 listStudents 缓存失效。
 * 用于调班(class.assign)等直接调 eaaBridge.execute 而不走 IPC 的场景。
 */
export function invalidateStudentsCacheExternal(): void {
  ipcMain.emit('__invalidate_students_cache')
}

// R131 修复: 防止 registerEAAHandlers 被多次调用时累积 ipcMain.on 监听器
let __invalidateListenerRegistered = false

// F1 修复: 防止重复注册写命令钩子(onWriteCommand 为覆盖语义,重复注册无害,守卫保持与 R131 一致)
let __writeHookRegistered = false

export function registerEAAHandlers(_win: BrowserWindow) {
  // ----- 共享缓存上下文 (staticCache/scoreCache 创建见 eaa/cache.ts) -----
  const { staticCache, scoreCache, setStaticCacheIfSuccess } = createEaaCacheContext()

  // 各域 handler 注册(共享缓存与缓存失效回调注入)
  registerSystemHandlers({ staticCache, setStaticCacheIfSuccess })
  registerStudentHandlers({ scoreCache, invalidateStudentsCache })
  registerEventHandlers({ invalidateStudentsCache })
  registerExportHandlers({ invalidateStudentsCache })

  // ----- ranking: Top-N 排行榜 (缓存 3s,写操作后自动失效) -----
  // v3.1.4 优化: EAA CLI 的 cmd_ranking 已返回 class_id (commands.rs cmd_ranking),
  // 不再需要额外 spawn list-students 来填充 class_id。
  // 此前每次 ranking 都触发一次冗余 list-students spawn (~2600ms),
  // 移除后 ranking 耗时预期从 ~5080ms 降到单次 spawn 开销。
  let rankingCache: { key: string; data: unknown; ts: number } | null = null
  const RANKING_CACHE_TTL_MS = 3_000

  ipcMain.handle(IPC.IPC_EAA_RANKING, async (_e, n?: number) => {
    const stop = startIpcTimer('eaa:ranking')
    try {
      // R86 软发现-1 修复：IPC 层也做参数校验，与 eaa-tools.ts rankingTool 保持一致
      // 拒绝非数字 / NaN / Infinity / 负数；undefined 和 0 视为"全部"，正整数正常处理
      if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
        return {
          success: false,
          error: `参数 n 必须是非负有限数,收到: ${JSON.stringify(n)}`,
          exitCode: -1,
        }
      }
      const cacheKey = String(n ?? 'all')
      const now = Date.now()
      if (
        rankingCache &&
        rankingCache.key === cacheKey &&
        now - rankingCache.ts < RANKING_CACHE_TTL_MS
      ) {
        return rankingCache.data
      }
      // 关键修复: EAA CLI `ranking [N]` 默认 N=10, 且 N=0 返回空(均非"全量")。
      // IPC 契约是 undefined/0 = 全量, 因此显式传一个覆盖任何现实规模的大 N。
      // 此前传 [] 导致 Dashboard 班级过滤只能看到全校 top10 内的学生(班级对比无数据)。
      const RANKING_ALL_N = '100000'
      const result = await eaaBridge.execute({
        command: 'ranking',
        args: n !== undefined && n > 0 ? [String(Math.min(1000, Math.floor(n)))] : [RANKING_ALL_N],
      })
      // class_id 已由 EAA CLI 返回,无需额外填充
      // 性能优化: 用 ranking 数据预填充 scoreCache(见 eaa/commands.ts)
      prefillScoreCacheFromRanking(scoreCache, result)
      if (result?.success) {
        rankingCache = { key: cacheKey, data: result, ts: now }
      }
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:ranking failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- list-students: 列出所有学生 -----
  // 性能优化: 缓存结果 3 秒,避免 Dashboard / Classes / Students 同时挂载时
  // 重复 spawn EAA 子进程(每次 spawn 约 200-500ms)。写操作(添加/删除/调班)
  // 完成后调用 invalidateStudentsCache() 让缓存失效,确保数据一致性。
  let studentsCache: { data: unknown; ts: number } | null = null
  const STUDENTS_CACHE_TTL_MS = 3_000

  ipcMain.handle(IPC.IPC_EAA_LIST_STUDENTS, async () => {
    try {
      const now = Date.now()
      if (studentsCache && now - studentsCache.ts < STUDENTS_CACHE_TTL_MS) {
        return studentsCache.data
      }
      const result = await eaaBridge.execute({ command: 'list-students', args: [] })
      if (result && typeof result === 'object' && (result as { success?: boolean }).success) {
        studentsCache = { data: result, ts: now }
      }
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:list-students failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  /** 写操作完成后调用,清空 listStudents/ranking/score/history/static 缓存 */
  function invalidateStudentsCache(): void {
    studentsCache = null
    rankingCache = null
    scoreCache.clear()
    staticCache.clear()
  }

  // 供 invalidateStudentsCacheExternal 跨模块调用
  // R131 修复: 添加去重守卫,防止多次注册 (ipcMain.on 不像 handle 会抛错)
  if (!__invalidateListenerRegistered) {
    __invalidateListenerRegistered = true
    ipcMain.on('__invalidate_students_cache', () => {
      studentsCache = null
      rankingCache = null
      scoreCache.clear()
      staticCache.clear()
    })
  }

  // F1 修复: Agent 工具(eaa/tools/*)与飞书 runEAA 直接调 eaaBridge.execute 写数据,
  // 不经过本文件 handler,导致 studentsCache/rankingCache/scoreCache/staticCache 不失效。
  // 通过桥接层写钩子在**写命令成功后**统一失效(与 invalidateStudentsCache 同一处注册,带防重入守卫)。
  // 各 handler 内的显式 invalidateStudentsCache() 调用保留(双失效无害,dryRun 等场景仍需精细控制)。
  if (!__writeHookRegistered) {
    __writeHookRegistered = true
    eaaBridge.onWriteCommand(() => invalidateStudentsCache())
  }

  // ----- invalidate-cache: 清空 EAA 读缓存 -----
  // 「刷新」按钮调用,使下次读取重新 spawn 拉取最新数据。
  // Electron 版的读缓存位于本 handler 闭包(studentsCache/rankingCache/scoreCache/staticCache),
  // 通过 emit 内部事件触发 invalidateStudentsCache() 清空。
  ipcMain.handle(IPC.IPC_EAA_INVALIDATE_CACHE, () => {
    invalidateStudentsCacheExternal()
    return { success: true }
  })

  console.log('[IPC] EAA handlers registered (21 commands + export-formats + invalidate-cache)')
}
