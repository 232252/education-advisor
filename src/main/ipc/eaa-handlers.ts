// =============================================================
// EAA 核心 IPC 处理器
// 完整覆盖 EAA CLI 全部 21 个子命令
// - 参数 sanitize 防止命令注入（P1-14）
// - 危险操作二次确认（P1-15）
// - query 复合参数引号支持（P1-16）
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { AddEventParams, SetStudentMetaParams } from '../../shared/types'
import { tokenizeQuery } from '../../shared/utils'
import { eaaBridge } from '../services/eaa-bridge'

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
 * classId sanitize：允许中文、字母数字、常见符号（班级名如"高三（1）班"）
 * 拒绝控制字符和 shell 危险字符
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
  // 只拒绝控制字符和 shell 危险字符，允许中文/括号/空格
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL-byte guard
  if (/\x00/.test(trimmed)) {
    throw new Error('classId contains null bytes')
  }
  if (/[`$;|&<>{}]/.test(trimmed)) {
    throw new Error('classId contains illegal characters')
  }
  return trimmed
}

/** B-24: tokenizeQuery 统一在 shared/utils.ts (本地删除) */

export function registerEAAHandlers(_win: BrowserWindow) {
  // ----- info: 系统信息 -----
  ipcMain.handle(IPC.IPC_EAA_INFO, async () => {
    return eaaBridge.execute({ command: 'info', args: [] })
  })

  // ----- score: 查询单个学生分数 -----
  ipcMain.handle(IPC.IPC_EAA_SCORE, async (_e, name: string) => {
    const safeName = sanitizeName(name, 'name')
    return eaaBridge.execute({ command: 'score', args: [safeName] })
  })

  // ----- ranking: Top-N 排行榜 -----
  ipcMain.handle(IPC.IPC_EAA_RANKING, async (_e, n?: number) => {
    return eaaBridge.execute({
      command: 'ranking',
      args: n !== undefined && n > 0 ? [String(Math.min(1000, Math.floor(n)))] : [],
    })
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
    if (params.delta !== undefined) args.push('--delta', String(params.delta))
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
    const safeName = sanitizeName(name, 'name')
    return eaaBridge.execute({ command: 'history', args: [safeName] })
  })

  // ----- search: 搜索事件 -----
  ipcMain.handle(IPC.IPC_EAA_SEARCH, async (_e, query: string, limit?: number) => {
    // 用 tokenizer 替代 split(' ')，支持双引号包裹的复合词
    const args = tokenizeQuery(query)
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
    const allowedFormats = new Set(['csv', 'json', 'markdown', 'html'])
    if (!allowedFormats.has(format)) {
      throw new Error(`format must be one of: ${[...allowedFormats].join(', ')}`)
    }
    const args = ['--format', format]
    if (outputFile) args.push('--output-file', outputFile)
    return eaaBridge.execute({ command: 'export', args })
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
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('filePath must be a non-empty string')
    }
    if (filePath.includes('\0')) {
      throw new Error('filePath contains null bytes')
    }
    return eaaBridge.execute({ command: 'import', args: [filePath] })
  })

  // ----- codes: 列出所有原因码 -----
  ipcMain.handle(IPC.IPC_EAA_CODES, async () => {
    return eaaBridge.execute({ command: 'codes', args: [] })
  })

  // ----- doctor: 环境健康检查 -----
  ipcMain.handle(IPC.IPC_EAA_DOCTOR, async () => {
    return eaaBridge.execute({ command: 'doctor', args: [] })
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
    const args: string[] = []
    if (outputDir) {
      if (outputDir.includes('\0')) {
        throw new Error('outputDir contains null bytes')
      }
      args.push('--output-dir', outputDir)
    }
    return eaaBridge.execute({ command: 'dashboard', args, timeout: 60_000 })
  })

  console.log('[IPC] EAA handlers registered (21 commands)')
}
