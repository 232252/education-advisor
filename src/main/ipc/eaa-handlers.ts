// =============================================================
// EAA 核心 IPC 处理器
// 完整覆盖 EAA CLI 全部 21 个子命令
// - 参数 sanitize 防止命令注入（P1-14）— 已抽到 ./eaa-sanitize
// - 危险操作二次确认（P1-15）
// - query 复合参数引号支持（P1-16）
// - 原因码查找已抽到 ./eaa-reason-codes(消除重复缓存)
// - 缓存使用 TtlLruCache(替代手写 Map+TTL+LRU,行为逐字节等价)
// - ranking/summary 性能优化:EAA CLI v3.1.4+ 已返回 class_id,
//   不再需要额外 spawn list-students(~2600ms 节省)
// - scoreCache 预填充:ranking 数据预热,后续 score 调用 95ms → 0.2ms
// =============================================================

import path from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { startIpcTimer } from '../../shared/debug'
import * as IPC from '../../shared/ipc-channels'
import type { AddEventParams, SetStudentMetaParams } from '../../shared/types'
import { eaaBridge } from '../services/eaa-bridge'
import { TtlLruCache } from '../services/eaa-cache'
import { lookupReasonCodeDelta } from './eaa-reason-codes'
import { sanitizeClassId, sanitizeFreeText, sanitizeName, tokenizeQuery } from './eaa-sanitize'

/**
 * 供 class-handlers 等其他模块调用,使 listStudents 缓存失效。
 * 用于调班(class.assign)等直接调 eaaBridge.execute 而不走 IPC 的场景。
 */
export function invalidateStudentsCacheExternal(): void {
  ipcMain.emit('__invalidate_students_cache')
}

// R131 修复: 防止 registerEAAHandlers 被多次调用时累积 ipcMain.on 监听器
let __invalidateListenerRegistered = false

export function registerEAAHandlers(_win: BrowserWindow) {
  // ----- 静态数据缓存 -----
  // info/codes/doctor/replay/tag/stats/validate/summary 返回的数据在会话期间基本不变,
  // 缓存以避免重复 spawn 子进程(~40ms/次)
  // 写操作(add-event/add-student/delete-student 等)完成后自动失效
  // MEDIUM 5.3: 用 TtlLruCache 替代手写 Map+TTL+LRU,行为逐字节等价
  // (过期主动删除 + 超容量删最旧 + 仅缓存 success:true 对象)
  const staticCache = new TtlLruCache<unknown>({ ttlMs: 30_000, maxEntries: 100 })

  /** 与原 setCached 行为一致:仅缓存 success:true 的对象 */
  function setStaticCacheIfSuccess(key: string, data: unknown): void {
    if (data && typeof data === 'object' && (data as { success?: boolean }).success) {
      staticCache.set(key, data)
    }
  }

  // ----- score: 查询单个学生分数 (缓存 3s,按学生名缓存) -----
  // H-3: 用 TtlLruCache 替代手写 Map+TTL+LRU,行为逐字节等价
  const scoreCache = new TtlLruCache<unknown>({ ttlMs: 3_000, maxEntries: 500 })

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
      // 之前 ranking(-1/NaN/1e10/'abc') 全部返回 success（fall back 到 full ranking）
      // 现在拒绝非数字 / NaN / Infinity / 负数；undefined 和 0 视为"全部"，正整数正常处理
      if (
        n !== undefined &&
        (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
      ) {
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
      const result = await eaaBridge.execute({
        command: 'ranking',
        args: n !== undefined && n > 0 ? [String(Math.min(1000, Math.floor(n)))] : [],
      })
      // class_id 已由 EAA CLI 返回,无需额外填充
      // 性能优化: 用 ranking 数据预填充 scoreCache
      // 这样后续 eaa:score 调用可直接命中缓存,避免 spawn EAA 二进制 (~95ms → 0.2ms)
      // 注意: scoreCache 按学生名缓存,ranking 的 name 字段是学生名,entity_id 是内部 ID
      const data = result?.data as
        | {
            ranking?: Array<{
              entity_id: string
              name?: string
              score?: number
              class_id?: string | null
            }>
          }
        | undefined
      if (result?.success && data?.ranking) {
        for (const item of data.ranking) {
          const studentName = item.name ?? item.entity_id
          if (studentName && typeof item.score === 'number') {
            scoreCache.set(studentName, {
              success: true,
              data: { score: item.score, entity_id: item.entity_id, name: studentName },
            })
          }
        }
      }
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

  // ----- add: 添加操行事件 -----
  // 注意: EAA CLI 的 add 命令不产生 JSON 输出，返回文本
  ipcMain.handle(IPC.IPC_EAA_ADD_EVENT, async (_e, params: AddEventParams) => {
    try {
      const safeName = sanitizeName(params.studentName, 'studentName')
      const safeCode = sanitizeName(params.reasonCode, 'reasonCode')
      const args: string[] = [safeName, safeCode]
      // delta 未提供时,自动从 reason-codes.json 查找默认值
      // 避免 EAA 二进制默认 0.0 导致校验失败
      const delta = params.delta ?? lookupReasonCodeDelta(params.reasonCode)
      if (delta !== undefined) args.push('--delta', String(delta))
      // 修复: note/reason 用 sanitizeFreeText(允许 / \ . () 等正常文本)
      // 此前用 sanitizeName 会拒绝 "迟到/早退" 等正常 note 文本
      if (params.note) args.push('--note', sanitizeFreeText(params.note, 'note', 500))
      if (params.operator) args.push('--operator', sanitizeName(params.operator, 'operator'))
      if (params.dryRun) args.push('--dry-run')
      if (params.force) args.push('--force')
      if (params.tags?.length)
        // v3.2.7 fix BUG#3: 与 EAA CLI v3.2.5+ 对齐,tags 分隔符从逗号改为分号
        // (Rust 端 commands.rs cmd_add 用 split(';') 解析,允许 tag 内含逗号)
        args.push('--tags', params.tags.map((t) => sanitizeName(t, 'tag')).join(';'))
      const result = await eaaBridge.execute({ command: 'add', args })
      // dryRun 模式不实际写入数据,不需要失效缓存
      if (!params.dryRun) invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:add-event failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- revert: 撤销事件 -----
  // 注意: revert 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_REVERT_EVENT, async (_e, eventId: string, reason: string) => {
    try {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] eaa:revert-event failed for "${eventId}":`, msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
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

  // ----- search: 搜索事件 -----
  ipcMain.handle(IPC.IPC_EAA_SEARCH, async (_e, query: string, limit?: number) => {
    try {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:search failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- range: 按日期范围查询事件 -----
  ipcMain.handle(IPC.IPC_EAA_RANGE, async (_e, start: string, end: string, limit?: number) => {
    try {
      // 日期格式校验：YYYY-MM-DD
      const dateRe = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRe.test(start) || !dateRe.test(end)) {
        return {
          success: false,
          error: 'start/end must be YYYY-MM-DD format',
          stderr: 'start/end must be YYYY-MM-DD format',
          exitCode: -1,
        }
      }
      // R3 修复: 校验 start <= end,避免 Rust CLI 静默返回 null 造成前端困惑
      if (start > end) {
        return {
          success: false,
          error: `start (${start}) must not be later than end (${end})`,
          stderr: `start (${start}) must not be later than end (${end})`,
          exitCode: -1,
        }
      }
      const args: string[] = [start, end]
      if (limit !== undefined && limit > 0) {
        args.push('--limit', String(Math.min(1000, Math.floor(limit))))
      }
      return await eaaBridge.execute({ command: 'range', args })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:range failed:', msg)
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

  // ----- export: 导出排名 -----
  // 注意: export 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_EXPORT, async (_e, format: string, outputFile?: string) => {
    const stop = startIpcTimer('eaa:export')
    try {
      // 动态从 EAA 获取支持的格式,避免硬编码与 Rust 源码不同步
      const allowedFormats = new Set(await eaaBridge.getSupportedExportFormats())
      if (!allowedFormats.has(format)) {
        return {
          success: false,
          error: `format must be one of: ${[...allowedFormats].join(', ')}`,
          stderr: `format must be one of: ${[...allowedFormats].join(', ')}`,
          exitCode: -1,
        }
      }
      const args = ['--format', format]
      if (outputFile) {
        if (typeof outputFile !== 'string' || outputFile.length === 0) {
          return {
            success: false,
            error: 'outputFile must be a non-empty string',
            stderr: 'outputFile must be a non-empty string',
            exitCode: -1,
          }
        }
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
        if (/\x00/.test(outputFile)) {
          return {
            success: false,
            error: 'outputFile contains null bytes',
            stderr: 'outputFile contains null bytes',
            exitCode: -1,
          }
        }
        // 路径遍历防护
        if (outputFile.includes('..')) {
          return {
            success: false,
            error: 'outputFile contains path traversal characters',
            stderr: 'outputFile contains path traversal characters',
            exitCode: -1,
          }
        }
        // 扩展名白名单(与 Rust 端实现对齐)
        const allowedExts = ['.csv', '.jsonl', '.html', '.json', '.txt']
        const ext = path.extname(outputFile).toLowerCase()
        if (ext && !allowedExts.includes(ext)) {
          return {
            success: false,
            error: `outputFile extension not allowed: ${ext}`,
            stderr: `outputFile extension not allowed: ${ext}`,
            exitCode: -1,
          }
        }
        args.push('--output-file', outputFile)
      }
      return await eaaBridge.execute({ command: 'export', args })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:export failed:', msg)
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
  // 支持 --clear-class-id 标志 (优先级高于 --class-id)
  ipcMain.handle(IPC.IPC_EAA_SET_STUDENT_META, async (_e, params: SetStudentMetaParams) => {
    try {
      const safeName = sanitizeName(params.name, 'name')
      const args: string[] = [safeName]
      if (params.group) args.push('--group', sanitizeName(params.group, 'group'))
      if (params.role) args.push('--role', sanitizeName(params.role, 'role'))
      if (params.clearClassId) {
        args.push('--clear-class-id')
      } else if (params.classId) {
        args.push('--class-id', sanitizeClassId(params.classId))
      }
      const result = await eaaBridge.execute({ command: 'set-student-meta', args })
      invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:set-student-meta failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    }
  })

  // ----- import: 批量导入学生 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_IMPORT, async (_e, filePath: string) => {
    const stop = startIpcTimer('eaa:import')
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return {
          success: false,
          error: 'filePath must be a non-empty string',
          stderr: 'filePath must be a non-empty string',
          exitCode: -1,
        }
      }
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
      if (/\x00/.test(filePath)) {
        return {
          success: false,
          error: 'filePath contains null bytes',
          stderr: 'filePath contains null bytes',
          exitCode: -1,
        }
      }
      // 路径遍历防护
      if (filePath.includes('..')) {
        return {
          success: false,
          error: 'filePath cannot contain path traversal (..)',
          stderr: 'filePath cannot contain path traversal (..)',
          exitCode: -1,
        }
      }
      // Rust 端只支持 JSON 格式导入(serde_json::from_str),白名单与 Rust 实现对齐
      const allowedExts = ['.json', '.jsonl']
      const ext = path.extname(filePath).toLowerCase()
      if (!allowedExts.includes(ext)) {
        return {
          success: false,
          error: `file extension not supported: ${ext}, allowed: ${allowedExts.join(', ')}`,
          stderr: `file extension not supported: ${ext}, allowed: ${allowedExts.join(', ')}`,
          exitCode: -1,
        }
      }
      const result = await eaaBridge.execute({ command: 'import', args: [filePath] })
      invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:import failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
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

  // ----- dashboard: 生成静态 HTML 仪表盘（60s 超时） -----
  ipcMain.handle(IPC.IPC_EAA_DASHBOARD, async (_e, outputDir?: string) => {
    const stop = startIpcTimer('eaa:dashboard')
    try {
      const args: string[] = []
      if (outputDir) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
        if (/\x00/.test(outputDir)) {
          return {
            success: false,
            error: 'outputDir contains null bytes',
            stderr: 'outputDir contains null bytes',
            exitCode: -1,
          }
        }
        // 路径遍历防护: 拒绝含 .. 的路径
        if (outputDir.includes('..')) {
          return {
            success: false,
            error: 'outputDir cannot contain path traversal (..)',
            stderr: 'outputDir cannot contain path traversal (..)',
            exitCode: -1,
          }
        }
        args.push('--output-dir', outputDir)
      }
      return await eaaBridge.execute({ command: 'dashboard', args, timeout: 60_000 })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:dashboard failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- export-formats: 动态从 EAA CLI 获取支持的导出格式 -----
  // 优先调用 eaaBridge.getSupportedExportFormats() 动态探测（运行 `eaa export --help`），
  // 探测失败或二进制不可用时降级到静态 SUPPORTED_EXPORT_FORMATS。
  // 这样 EAA 升级新增格式时前端无需改动即可自动适配。
  ipcMain.handle(IPC.IPC_EAA_EXPORT_FORMATS, async () => {
    try {
      return await eaaBridge.getSupportedExportFormats()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:export-formats failed:', msg)
      return []
    }
  })

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
