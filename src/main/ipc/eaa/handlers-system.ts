// =============================================================
// EAA 系统诊断/静态数据域 IPC 处理器
// info / replay / tag / stats / validate / codes / doctor / summary
// 从 eaa-handlers.ts 抽出,handler 体逐行对照搬迁
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { eaaBridge } from '../../services/eaa-bridge'
import type { TtlLruCache } from '../../services/eaa-cache'
import { sanitizeName } from '../eaa-sanitize'

export interface SystemHandlersContext {
  /** 静态数据缓存(30s) */
  staticCache: TtlLruCache<unknown>
  /** 与原 setCached 行为一致:仅缓存 success:true 的对象 */
  setStaticCacheIfSuccess: (key: string, data: unknown) => void
}

export function registerSystemHandlers({
  staticCache,
  setStaticCacheIfSuccess,
}: SystemHandlersContext): void {
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
}
