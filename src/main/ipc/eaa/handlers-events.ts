// =============================================================
// EAA 事件域 IPC 处理器
// add-event / revert-event / search / range
// 从 eaa-handlers.ts 抽出,handler 体逐行对照搬迁
// 失败骨架统一走 handleIpc + eaaReject(日志格式/信封形状与原 eaaFailure 逐字一致)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { AddEventParams, EAARangeData } from '@shared/types'
import { eaaBridge } from '../../services/eaa-bridge'
import { sanitizeFreeText, sanitizeName, tokenizeQuery } from '../../utils/sanitize'
import { handleIpc } from '../handle'
import { eaaReject } from './failures'
import { buildAddEventArgs, buildRangeArgs } from './params'

interface EventHandlersContext {
  /** 写操作完成后清空缓存(由 eaa-handlers.ts 提供) */
  invalidateStudentsCache: () => void
}

export function registerEventHandlers({ invalidateStudentsCache }: EventHandlersContext): void {
  // ----- add: 添加操行事件 -----
  // 注意: EAA CLI 的 add 命令不产生 JSON 输出，返回文本
  handleIpc(
    IPC.IPC_EAA_ADD_EVENT,
    async (_e, params: AddEventParams) => {
      const args = buildAddEventArgs(params)
      const result = await eaaBridge.execute({ command: 'add', args })
      // dryRun 模式不实际写入数据,不需要失效缓存
      if (!params.dryRun) invalidateStudentsCache()
      return result
    },
    { onError: eaaReject },
  )

  // ----- revert: 撤销事件 -----
  // 注意: revert 不产生 JSON 输出
  handleIpc(
    IPC.IPC_EAA_REVERT_EVENT,
    async (_e, eventId: string, reason: string) => {
      const safeId = sanitizeName(eventId, 'eventId')
      // 修复: reason 用 sanitizeFreeText
      const safeReason = sanitizeFreeText(reason, 'reason', 200)
      const result = await eaaBridge.execute({
        command: 'revert',
        args: [safeId, '--reason', safeReason],
      })
      // 撤销事件改变排名/分数/历史,需失效缓存
      invalidateStudentsCache()
      return result
    },
    {
      onError: eaaReject,
      // biome-ignore lint/suspicious/noExplicitAny: 阻断 label 参数参与 A 的泛型推断(见 handle.ts)
      label: (...args: any[]) => `eaa:revert-event failed for "${args[0]}"`,
    },
  )

  // ----- search: 搜索事件 -----
  handleIpc(
    IPC.IPC_EAA_SEARCH,
    async (_e, query: string, limit?: number) => {
      if (typeof query !== 'string') {
        return {
          success: false,
          error: 'query must be a string',
          stderr: 'query must be a string',
          exitCode: -1,
        }
      }
      // 防止 spawn ENAMETOOLONG: 总参数长度限制 (32KB,保守估计,Windows 命令行长限制 ~32K)
      const MAX_QUERY_LEN = 8192
      const safeQuery = query.length > MAX_QUERY_LEN ? query.slice(0, MAX_QUERY_LEN) : query
      // 拒绝控制字符(防止参数注入和数据损坏)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char guard
      if (/[\x00-\x1F\x7F]/.test(safeQuery)) {
        return {
          success: false,
          error: 'query contains control characters',
          stderr: 'query contains control characters',
          exitCode: -1,
        }
      }
      // 剥离零宽 Unicode 字符后 trim
      const cleaned = safeQuery
        .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
        .trim()
      if (cleaned.length === 0) {
        return { success: true, data: { events: [], students: [] } }
      }
      // 用 tokenizer 替代 split(' ')，支持双引号包裹的复合词
      // 过滤掉 -- 前缀(防参数注入)和 shell 元字符
      const args = tokenizeQuery(cleaned).filter((t) => {
        if (t.startsWith('--')) return false
        if (/[`$;|&<>{}\\]/.test(t)) return false
        return t.length > 0
      })
      if (args.length === 0) {
        return { success: true, data: { events: [], students: [] } }
      }
      if (limit !== undefined && limit > 0) {
        args.push('--limit', String(Math.min(1000, Math.floor(limit))))
      }
      return await eaaBridge.execute({ command: 'search', args })
    },
    { onError: eaaReject },
  )

  // ----- range: 按日期范围查询事件 -----
  handleIpc(
    IPC.IPC_EAA_RANGE,
    async (_e, start: string, end: string, limit?: number) => {
      const built = buildRangeArgs(start, end, limit)
      if (!built.ok) {
        return { success: false, error: built.error, stderr: built.error, exitCode: -1 }
      }
      // M10: 有效 limit 与 buildRangeArgs 的截断逻辑一致;未传 limit 时取 Rust CLI 默认 1000
      const effectiveLimit =
        limit !== undefined && limit > 0 ? Math.min(1000, Math.floor(limit)) : 1000
      const result = await eaaBridge.execute<EAARangeData>({ command: 'range', args: built.args })
      // M10: 截断告警 — events 达到有效 limit 时附加 truncated: true,前端据此提示缩小日期范围
      if (
        result.success &&
        result.data &&
        Array.isArray(result.data.events) &&
        result.data.events.length >= effectiveLimit
      ) {
        result.data.truncated = true
      }
      return result
    },
    { onError: eaaReject },
  )
}
