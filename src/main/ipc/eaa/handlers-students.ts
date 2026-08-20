// =============================================================
// EAA 学生域 IPC 处理器
// score / history / add-student / delete-student / set-student-meta
// 从 eaa-handlers.ts 抽出,handler 体逐行对照搬迁
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import type { SetStudentMetaParams } from '@shared/types'
import { ipcMain } from 'electron'
import { eaaBridge } from '../../services/eaa-bridge'
import type { TtlLruCache } from '../../services/eaa-cache'
import { sanitizeFreeText, sanitizeName } from '../../utils/sanitize'
import { buildSetStudentMetaArgs } from './params'

export interface StudentHandlersContext {
  /** score/history 结果缓存(3s,按学生名缓存) */
  scoreCache: TtlLruCache<unknown>
  /** 写操作完成后清空缓存(由 eaa-handlers.ts 提供,含 studentsCache/rankingCache 重置) */
  invalidateStudentsCache: () => void
}

export function registerStudentHandlers({
  scoreCache,
  invalidateStudentsCache,
}: StudentHandlersContext): void {
  // ----- score: 查询单个学生分数 -----
  ipcMain.handle(IPC.IPC_EAA_SCORE, async (_e, name: string) => {
    const stop = startIpcTimer('eaa:score')
    try {
      const safeName = sanitizeName(name, 'name')
      // TtlLruCache.get 内部已处理 TTL 过期(过期则主动删除并返回 null)
      const cached = scoreCache.get(safeName)
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'score', args: [safeName] })
      if (result?.success) {
        scoreCache.set(safeName, result) // TtlLruCache.set 内部处理超容量 LRU 驱逐
      }
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] eaa:score failed for "${name}":`, msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- history: 学生事件时间线 (缓存 3s,按学生名缓存) -----
  ipcMain.handle(IPC.IPC_EAA_HISTORY, async (_e, name: string) => {
    const stop = startIpcTimer('eaa:history')
    try {
      const safeName = sanitizeName(name, 'name')
      const cached = scoreCache.get(`hist:${safeName}`) // TtlLruCache.get 内部处理 TTL
      if (cached) return cached
      const result = await eaaBridge.execute({ command: 'history', args: [safeName] })
      if (result?.success) scoreCache.set(`hist:${safeName}`, result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] eaa:history failed for "${name}":`, msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- add-student: 添加学生 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_ADD_STUDENT, async (_e, name: string) => {
    try {
      const safeName = sanitizeName(name, 'name')
      const result = await eaaBridge.execute({ command: 'add-student', args: [safeName] })
      invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] eaa:add-student failed for "${name}":`, msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- delete-student: 删除学生（P1-15 二次确认） -----
  // 注意: 不产生 JSON 输出
  // 必须显式传 confirm=true 才会真正执行删除；否则返回预览
  ipcMain.handle(
    IPC.IPC_EAA_DELETE_STUDENT,
    async (_e, name: string, options?: { confirm?: boolean; reason?: string }) => {
      try {
        const safeName = sanitizeName(name, 'name')
        if (!options?.confirm) {
          // 二次确认：未传 confirm 时返回预览，不实际删除
          return {
            success: false,
            requiresConfirmation: true,
            message: `About to delete student "${safeName}". Re-call with { confirm: true } to proceed.`,
            data: { parsed: false, raw: '', stderr: 'Confirmation required' },
            stderr: 'Confirmation required',
            exitCode: -1,
          }
        }
        const args = [safeName, '--confirm']
        if (options.reason) {
          // 修复: reason 用 sanitizeFreeText
          args.push('--reason', sanitizeFreeText(options.reason, 'reason', 200))
        }
        const result = await eaaBridge.execute({ command: 'delete-student', args })
        invalidateStudentsCache()
        return result
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] eaa:delete-student failed for "${name}":`, msg)
        return { success: false, error: msg, stderr: msg, exitCode: -1 }
      }
    },
  )

  // ----- set-student-meta: 设置学生属性 -----
  // 注意: 不产生 JSON 输出
  // 支持 --clear-class-id 标志 (优先级高于 --class-id),参数组装见 eaa/params.ts
  ipcMain.handle(IPC.IPC_EAA_SET_STUDENT_META, async (_e, params: SetStudentMetaParams) => {
    try {
      const args = buildSetStudentMetaArgs(params)
      const result = await eaaBridge.execute({ command: 'set-student-meta', args })
      invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:set-student-meta failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })
}
