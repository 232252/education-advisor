// =============================================================
// EAA 系统诊断/静态数据域 IPC 处理器
// info / replay / tag / stats / validate / codes / doctor / summary
// + ranking / list-students / invalidate-cache(M18 从 eaa-handlers.ts 迁入,
//   handler 体逐行对照搬迁,含 studentsCache/rankingCache 与失效编排)
// 返回 invalidateStudentsCache 供 students/events/export 域共享
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { eaaBridge } from '../../services/eaa-bridge'
import type { TtlLruCache } from '../../services/eaa-cache'
import { sanitizeName } from '../../utils/sanitize'
import { prefillScoreCacheFromRanking } from './cache'

export interface SystemHandlersContext {
  /** 静态数据缓存(30s) */
  staticCache: TtlLruCache<unknown>
  /** score/history 缓存(3s,按学生名缓存) */
  scoreCache: TtlLruCache<unknown>
  /** 与原 setCached 行为一致:仅缓存 success:true 的对象 */
  setStaticCacheIfSuccess: (key: string, data: unknown) => void
}

// R131 修复: 防止 registerEAAHandlers 被多次调用时累积 ipcMain.on 监听器
// (M18 随 '__invalidate_students_cache' 监听器从 eaa-handlers.ts 迁入)
let __invalidateListenerRegistered = false

// F1 修复: 防止重复注册写命令钩子(onWriteCommand 为覆盖语义,重复注册无害,守卫保持与 R131 一致)
// (M18 随写钩子从 eaa-handlers.ts 迁入)
let __writeHookRegistered = false

export function registerSystemHandlers({
  staticCache,
  scoreCache,
  setStaticCacheIfSuccess,
}: SystemHandlersContext): { invalidateStudentsCache: () => void } {
  // ----- info: 系统信息 (缓存 30s) -----
  ipcMain.handle(IPC.IPC_EAA_INFO, async () => {
    try {
      const cached = staticCache.get('info')
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'info', args: [] })
      setStaticCacheIfSuccess('info', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:info failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- replay: 全量重放排名 (缓存 30s) -----
  ipcMain.handle(IPC.IPC_EAA_REPLAY, async () => {
    try {
      const cached = staticCache.get('replay')
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'replay', args: [] })
      setStaticCacheIfSuccess('replay', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:replay failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- tag: 标签管理 (缓存 30s,标签在运行期间很少变化) -----
  ipcMain.handle(IPC.IPC_EAA_TAG, async (_e, tag?: string) => {
    try {
      const safeTag = tag ? sanitizeName(tag, 'tag') : undefined
      const cacheKey = `tag:${safeTag ?? 'all'}`
      const cached = staticCache.get(cacheKey)
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'tag', args: safeTag ? [safeTag] : [] })
      setStaticCacheIfSuccess(cacheKey, result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:tag failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- stats: 数据统计 (缓存 30s) -----
  ipcMain.handle(IPC.IPC_EAA_STATS, async () => {
    try {
      const cached = staticCache.get('stats')
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'stats', args: [] })
      setStaticCacheIfSuccess('stats', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:stats failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- validate: 验证所有事件 (缓存 30s) -----
  ipcMain.handle(IPC.IPC_EAA_VALIDATE, async () => {
    try {
      const cached = staticCache.get('validate')
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'validate', args: [] })
      setStaticCacheIfSuccess('validate', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:validate failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- codes: 列出所有原因码 (缓存 30s, 原因码在运行期间不变) -----
  ipcMain.handle(IPC.IPC_EAA_CODES, async () => {
    try {
      const cached = staticCache.get('codes')
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'codes', args: [] })
      setStaticCacheIfSuccess('codes', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:codes failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- doctor: 环境健康检查 (缓存 30s, --fix 时不缓存) -----
  ipcMain.handle(IPC.IPC_EAA_DOCTOR, async (_e, fix?: boolean) => {
    const stop = startIpcTimer('eaa:doctor')
    try {
      // fix=true 时不读缓存 (修复后状态已变)
      if (!fix) {
        const cached = staticCache.get('doctor')
        if (cached) return cached
      }
      const args = fix ? ['--fix'] : []
      const result = await eaaBridge.execute({ command: 'doctor', args })
      // fix=true 时不写缓存 (修复结果不缓存), 同时失效其他缓存
      if (fix) {
        staticCache.delete('doctor')
        staticCache.delete('info')
        staticCache.delete('codes')
      } else {
        setStaticCacheIfSuccess('doctor', result)
      }
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:doctor failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- summary: 周期摘要 (缓存 3s,按日期范围缓存) -----
  // v3.1.4 优化: EAA CLI 的 cmd_summary 已返回 class_id (commands.rs cmd_summary),
  // top_gainers/top_losers 已包含 class_id,不再需要额外 spawn list-students。
  ipcMain.handle(IPC.IPC_EAA_SUMMARY, async (_e, since?: string, until?: string) => {
    try {
      // R14 加固: 类型校验, 拒绝对象/数组等非字符串参数 (防止前端误传 {})
      if (since !== undefined && typeof since !== 'string') {
        return {
          success: false,
          error: `since must be a string, got ${typeof since}`,
          stderr: `since must be a string, got ${typeof since}`,
          exitCode: -1,
        }
      }
      if (until !== undefined && typeof until !== 'string') {
        return {
          success: false,
          error: `until must be a string, got ${typeof until}`,
          stderr: `until must be a string, got ${typeof until}`,
          exitCode: -1,
        }
      }
      const args: string[] = []
      const dateRe = /^\d{4}-\d{2}-\d{2}$/
      if (since) {
        if (!dateRe.test(since)) {
          return {
            success: false,
            error: 'since must be YYYY-MM-DD format',
            stderr: 'since must be YYYY-MM-DD format',
            exitCode: -1,
          }
        }
        args.push('--since', since)
      }
      if (until) {
        if (!dateRe.test(until)) {
          return {
            success: false,
            error: 'until must be YYYY-MM-DD format',
            stderr: 'until must be YYYY-MM-DD format',
            exitCode: -1,
          }
        }
        args.push('--until', until)
      }
      const cacheKey = `summary:${since ?? ''}:${until ?? ''}`
      const cached = staticCache.get(cacheKey)
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'summary', args })
      setStaticCacheIfSuccess(cacheKey, result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:summary failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- ranking: Top-N 排行榜 (缓存 3s,写操作后自动失效) -----
  // (M18 从 eaa-handlers.ts 迁入,逻辑零修改)
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
      // 性能优化: 用 ranking 数据预填充 scoreCache(见 eaa/cache.ts)
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
  // (M18 从 eaa-handlers.ts 迁入,逻辑零修改)
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

  // 供 invalidateStudentsCacheExternal(eaa-handlers.ts)跨模块调用
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
  // 不经过 handler,导致 studentsCache/rankingCache/scoreCache/staticCache 不失效。
  // 通过桥接层写钩子在**写命令成功后**统一失效(与 invalidateStudentsCache 同一处注册,带防重入守卫)。
  // 各 handler 内的显式 invalidateStudentsCache() 调用保留(双失效无害,dryRun 等场景仍需精细控制)。
  if (!__writeHookRegistered) {
    __writeHookRegistered = true
    eaaBridge.onWriteCommand(() => invalidateStudentsCache())
  }

  // ----- invalidate-cache: 清空 EAA 读缓存 -----
  // 「刷新」按钮调用,使下次读取重新 spawn 拉取最新数据。
  // Electron 版的读缓存位于 handlers 闭包(studentsCache/rankingCache/scoreCache/staticCache),
  // 通过 emit 内部事件触发 invalidateStudentsCache() 清空。
  ipcMain.handle(IPC.IPC_EAA_INVALIDATE_CACHE, () => {
    ipcMain.emit('__invalidate_students_cache')
    return { success: true }
  })

  return { invalidateStudentsCache }
}
