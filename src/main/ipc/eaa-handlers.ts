// =============================================================
// EAA 核心 IPC 处理器
// 完整覆盖 EAA CLI 全部 21 个子命令
// - 参数 sanitize 防止命令注入（P1-14）
// - 危险操作二次确认（P1-15）
// - query 复合参数引号支持（P1-16）
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { startIpcTimer } from '../../shared/debug'
import * as IPC from '../../shared/ipc-channels'
import type { AddEventParams, SetStudentMetaParams } from '../../shared/types'
import { eaaBridge } from '../services/eaa-bridge'

/**
 * 查找原因码的默认 delta 值。
 * 当 addEvent 调用未提供 delta 时,从 config/reason-codes.json 读取默认值。
 * 这解决了 EAA 二进制不传 --delta 时默认 0.0 导致校验失败的问题。
 */
let cachedReasonCodes: Record<string, { delta: number | null }> | null = null
function lookupReasonCodeDelta(reasonCode: string): number | undefined {
  try {
    if (!cachedReasonCodes) {
      const devPath = path.join(__dirname, '..', '..', 'config', 'reason-codes.json')
      const prodPath = path.join(process.resourcesPath, 'config', 'reason-codes.json')
      const codesPath = fs.existsSync(devPath) ? devPath : prodPath
      if (!fs.existsSync(codesPath)) return undefined
      cachedReasonCodes = JSON.parse(fs.readFileSync(codesPath, 'utf-8'))
    }
    const entry = cachedReasonCodes ? cachedReasonCodes[reasonCode] : undefined
    if (entry && typeof entry.delta === 'number') return entry.delta
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 参数 sanitize：允许字母、数字、中文、常见姓名符号（'()·.）、下划线、连字符。
 * 剥离不可见 Unicode 字符，拒绝 NUL 和以 -- 开头的输入（防止参数注入）。
 */
function sanitizeName(name: string, field: string): string {
  if (typeof name !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  // 剥离不可见 Unicode 字符（零宽空格、BOM 等）
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error(`${field} cannot be empty`)
  }
  if (cleaned.length > 64) {
    throw new Error(`${field} too long (max 64 chars)`)
  }
  // 仅拒绝 NUL 字节和真正的 shell 危险字符（允许 ' ( ) 等姓名常见字符）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard against shell injection
  if (/\x00/.test(cleaned)) {
    throw new Error(`${field} contains null bytes`)
  }
  if (/[`$;|&<>{}\\]/.test(cleaned)) {
    throw new Error(`${field} contains illegal characters`)
  }
  // 拒绝以 -- 开头的输入（防止参数注入）
  if (cleaned.startsWith('--')) {
    throw new Error(`${field} cannot start with --`)
  }
  return cleaned
}

/**
 * classId sanitize：只允许字母数字、连字符、点（用于班级编号如 "G7-3"）
 */
function sanitizeClassId(classId: string): string {
  if (typeof classId !== 'string') {
    throw new Error('classId must be a string')
  }
  const trimmed = classId.trim()
  if (trimmed.length === 0) {
    throw new Error('classId cannot be empty')
  }
  if (trimmed.length > 32) {
    throw new Error('classId too long (max 32 chars)')
  }
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) {
    throw new Error('classId must be alphanumeric, dot or hyphen only')
  }
  return trimmed
}

/**
 * 简单 shell-style tokenizer：支持双引号包裹含空格的复合参数。
 * 不支持转义引号（够用即可，避免与 Rust 端行为不一致）。
 */
function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

export function registerEAAHandlers(_win: BrowserWindow) {
  // ----- info: 系统信息 -----
  ipcMain.handle(IPC.IPC_EAA_INFO, async () => {
    return eaaBridge.execute({ command: 'info', args: [] })
  })

  // ----- score: 查询单个学生分数 -----
  ipcMain.handle(IPC.IPC_EAA_SCORE, async (_e, name: string) => {
    const stop = startIpcTimer('eaa:score')
    try {
      const safeName = sanitizeName(name, 'name')
      return await eaaBridge.execute({ command: 'score', args: [safeName] })
    } finally {
      stop()
    }
  })

  // ----- ranking: Top-N 排行榜 -----
  ipcMain.handle(IPC.IPC_EAA_RANKING, async (_e, n?: number) => {
    const stop = startIpcTimer('eaa:ranking')
    try {
      return await eaaBridge.execute({
        command: 'ranking',
        args: n !== undefined && n > 0 ? [String(Math.min(1000, Math.floor(n)))] : [],
      })
    } finally {
      stop()
    }
  })

  // ----- replay: 全量重放排名 -----
  ipcMain.handle(IPC.IPC_EAA_REPLAY, async () => {
    return eaaBridge.execute({ command: 'replay', args: [] })
  })

  // ----- add: 添加操行事件 -----
  // 注意: EAA CLI 的 add 命令不产生 JSON 输出，返回文本
  ipcMain.handle(IPC.IPC_EAA_ADD_EVENT, async (_e, params: AddEventParams) => {
    const safeName = sanitizeName(params.studentName, 'studentName')
    const safeCode = sanitizeName(params.reasonCode, 'reasonCode')
    const args: string[] = [safeName, safeCode]
    // delta 未提供时,自动从 reason-codes.json 查找默认值
    // 避免 EAA 二进制默认 0.0 导致校验失败
    const delta = params.delta ?? lookupReasonCodeDelta(params.reasonCode)
    if (delta !== undefined) args.push('--delta', String(delta))
    if (params.note) args.push('--note', sanitizeName(params.note, 'note'))
    if (params.operator) args.push('--operator', sanitizeName(params.operator, 'operator'))
    if (params.dryRun) args.push('--dry-run')
    if (params.force) args.push('--force')
    if (params.tags?.length)
      args.push('--tags', params.tags.map((t) => sanitizeName(t, 'tag')).join(','))
    return eaaBridge.execute({ command: 'add', args })
  })

  // ----- revert: 撤销事件 -----
  // 注意: revert 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_REVERT_EVENT, async (_e, eventId: string, reason: string) => {
    const safeId = sanitizeName(eventId, 'eventId')
    const safeReason = sanitizeName(reason, 'reason')
    return eaaBridge.execute({ command: 'revert', args: [safeId, '--reason', safeReason] })
  })

  // ----- history: 学生事件时间线 -----
  ipcMain.handle(IPC.IPC_EAA_HISTORY, async (_e, name: string) => {
    const stop = startIpcTimer('eaa:history')
    try {
      const safeName = sanitizeName(name, 'name')
      return await eaaBridge.execute({ command: 'history', args: [safeName] })
    } finally {
      stop()
    }
  })

  // ----- search: 搜索事件 -----
  ipcMain.handle(IPC.IPC_EAA_SEARCH, async (_e, query: string, limit?: number) => {
    if (typeof query !== 'string') {
      throw new Error('query must be a string')
    }
    // 防止 spawn ENAMETOOLONG: 总参数长度限制 (32KB,保守估计,Windows 命令行长限制 ~32K)
    const MAX_QUERY_LEN = 8192
    const safeQuery = query.length > MAX_QUERY_LEN ? query.slice(0, MAX_QUERY_LEN) : query
    // 用 tokenizer 替代 split(' ')，支持双引号包裹的复合词
    const args = tokenizeQuery(safeQuery)
    if (limit !== undefined && limit > 0) {
      args.push('--limit', String(Math.min(1000, Math.floor(limit))))
    }
    return eaaBridge.execute({ command: 'search', args })
  })

  // ----- range: 按日期范围查询事件 -----
  ipcMain.handle(IPC.IPC_EAA_RANGE, async (_e, start: string, end: string, limit?: number) => {
    // 日期格式校验：YYYY-MM-DD
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRe.test(start) || !dateRe.test(end)) {
      throw new Error('start/end must be YYYY-MM-DD format')
    }
    const args: string[] = [start, end]
    if (limit !== undefined && limit > 0) {
      args.push('--limit', String(Math.min(1000, Math.floor(limit))))
    }
    return eaaBridge.execute({ command: 'range', args })
  })

  // ----- tag: 标签管理 -----
  ipcMain.handle(IPC.IPC_EAA_TAG, async (_e, tag?: string) => {
    const safeTag = tag ? sanitizeName(tag, 'tag') : undefined
    return eaaBridge.execute({ command: 'tag', args: safeTag ? [safeTag] : [] })
  })

  // ----- stats: 数据统计 -----
  ipcMain.handle(IPC.IPC_EAA_STATS, async () => {
    return eaaBridge.execute({ command: 'stats', args: [] })
  })

  // ----- validate: 验证所有事件 -----
  ipcMain.handle(IPC.IPC_EAA_VALIDATE, async () => {
    return eaaBridge.execute({ command: 'validate', args: [] })
  })

  // ----- export: 导出排名 -----
  // 注意: export 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_EXPORT, async (_e, format: string, outputFile?: string) => {
    const stop = startIpcTimer('eaa:export')
    try {
      // 动态从 EAA 获取支持的格式,避免硬编码与 Rust 源码不同步
      const allowedFormats = new Set(await eaaBridge.getSupportedExportFormats())
      if (!allowedFormats.has(format)) {
        throw new Error(`format must be one of: ${[...allowedFormats].join(', ')}`)
      }
      const args = ['--format', format]
      if (outputFile) args.push('--output-file', outputFile)
      return await eaaBridge.execute({ command: 'export', args })
    } finally {
      stop()
    }
  })

  // ----- list-students: 列出所有学生 -----
  ipcMain.handle(IPC.IPC_EAA_LIST_STUDENTS, async () => {
    return eaaBridge.execute({ command: 'list-students', args: [] })
  })

  // ----- add-student: 添加学生 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_ADD_STUDENT, async (_e, name: string) => {
    const safeName = sanitizeName(name, 'name')
    return eaaBridge.execute({ command: 'add-student', args: [safeName] })
  })

  // ----- delete-student: 删除学生（P1-15 二次确认） -----
  // 注意: 不产生 JSON 输出
  // 必须显式传 confirm=true 才会真正执行删除；否则返回预览
  ipcMain.handle(
    IPC.IPC_EAA_DELETE_STUDENT,
    async (_e, name: string, options?: { confirm?: boolean; reason?: string }) => {
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
        args.push('--reason', sanitizeName(options.reason, 'reason'))
      }
      return eaaBridge.execute({ command: 'delete-student', args })
    },
  )

  // ----- set-student-meta: 设置学生属性 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_SET_STUDENT_META, async (_e, params: SetStudentMetaParams) => {
    const safeName = sanitizeName(params.name, 'name')
    const args: string[] = [safeName]
    if (params.group) args.push('--group', sanitizeName(params.group, 'group'))
    if (params.role) args.push('--role', sanitizeName(params.role, 'role'))
    if (params.classId) args.push('--class-id', sanitizeClassId(params.classId))
    return eaaBridge.execute({ command: 'set-student-meta', args })
  })

  // ----- import: 批量导入学生 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_IMPORT, async (_e, filePath: string) => {
    const stop = startIpcTimer('eaa:import')
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('filePath must be a non-empty string')
      }
      if (filePath.includes('\0')) {
        throw new Error('filePath contains null bytes')
      }
      return await eaaBridge.execute({ command: 'import', args: [filePath] })
    } finally {
      stop()
    }
  })

  // ----- codes: 列出所有原因码 -----
  ipcMain.handle(IPC.IPC_EAA_CODES, async () => {
    return eaaBridge.execute({ command: 'codes', args: [] })
  })

  // ----- doctor: 环境健康检查 -----
  ipcMain.handle(IPC.IPC_EAA_DOCTOR, async () => {
    const stop = startIpcTimer('eaa:doctor')
    try {
      return await eaaBridge.execute({ command: 'doctor', args: [] })
    } finally {
      stop()
    }
  })

  // ----- summary: 周期摘要 -----
  ipcMain.handle(IPC.IPC_EAA_SUMMARY, async (_e, since?: string, until?: string) => {
    const args: string[] = []
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (since) {
      if (!dateRe.test(since)) throw new Error('since must be YYYY-MM-DD format')
      args.push('--since', since)
    }
    if (until) {
      if (!dateRe.test(until)) throw new Error('until must be YYYY-MM-DD format')
      args.push('--until', until)
    }
    return eaaBridge.execute({ command: 'summary', args })
  })

  // ----- dashboard: 生成静态 HTML 仪表盘（60s 超时） -----
  ipcMain.handle(IPC.IPC_EAA_DASHBOARD, async (_e, outputDir?: string) => {
    const stop = startIpcTimer('eaa:dashboard')
    try {
      const args: string[] = []
      if (outputDir) {
        if (outputDir.includes('\0')) {
          throw new Error('outputDir contains null bytes')
        }
        args.push('--output-dir', outputDir)
      }
      return await eaaBridge.execute({ command: 'dashboard', args, timeout: 60_000 })
    } finally {
      stop()
    }
  })

  // ----- export-formats: 动态从 EAA CLI 获取支持的导出格式 -----
  // 优先调用 eaaBridge.getSupportedExportFormats() 动态探测（运行 `eaa export --help`），
  // 探测失败或二进制不可用时降级到静态 SUPPORTED_EXPORT_FORMATS。
  // 这样 EAA 升级新增格式时前端无需改动即可自动适配。
  ipcMain.handle(IPC.IPC_EAA_EXPORT_FORMATS, async () => {
    return await eaaBridge.getSupportedExportFormats()
  })

  console.log('[IPC] EAA handlers registered (21 commands + export-formats)')
}
