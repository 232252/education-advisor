// =============================================================
// EAA 命令参数组装 / 结果解包辅助（纯函数）
// M18: 从 eaa/commands.ts 迁入(原文件拆分为 params.ts + cache.ts,
// 参数组装归本文件,缓存预热 prefillScoreCacheFromRanking 归 cache.ts)
// 校验失败时返回 { ok: false, error },由调用方包装为
// { success: false, error, stderr, exitCode: -1 } 返回渲染进程
// =============================================================

import path from 'node:path'
import type { SetStudentMetaParams } from '@shared/types'
import { buildAddEventArgs as buildAddEventArgsImpl } from '../../services/eaa/arg-builders'
import { sanitizeClassId, sanitizeName } from '../../utils/sanitize'

/** 参数组装结果: ok=false 时 error 同时用于 IPC 返回的 error/stderr 字段 */
export type CommandArgsResult = { ok: true; args: string[] } | { ok: false; error: string }

// buildAddEventArgs 权威实现已移至 services/eaa/arg-builders.ts
// (addEventTool 与 IPC handler 共用同一份组装逻辑,消除 tags/delta 行为漂移),
// 此处 re-export 保持旧导入路径(handlers-events.ts 等)不变。
export { buildAddEventArgsImpl as buildAddEventArgs }

/** 组装 set-student-meta 命令参数。支持 --clear-class-id 标志 (优先级高于 --class-id)。 */
export function buildSetStudentMetaArgs(params: SetStudentMetaParams): string[] {
  const safeName = sanitizeName(params.name, 'name')
  const args: string[] = [safeName]
  if (params.group) args.push('--group', sanitizeName(params.group, 'group'))
  if (params.role) args.push('--role', sanitizeName(params.role, 'role'))
  if (params.clearClassId) {
    args.push('--clear-class-id')
  } else if (params.classId) {
    args.push('--class-id', sanitizeClassId(params.classId))
  }
  return args
}

/** 校验并组装 range 命令参数(YYYY-MM-DD 格式 + start<=end + limit) */
export function buildRangeArgs(start: string, end: string, limit?: number): CommandArgsResult {
  // 日期格式校验：YYYY-MM-DD
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRe.test(start) || !dateRe.test(end)) {
    return { ok: false, error: 'start/end must be YYYY-MM-DD format' }
  }
  // R3 修复: 校验 start <= end,避免 Rust CLI 静默返回 null 造成前端困惑
  if (start > end) {
    return { ok: false, error: `start (${start}) must not be later than end (${end})` }
  }
  const args: string[] = [start, end]
  if (limit !== undefined && limit > 0) {
    args.push('--limit', String(Math.min(1000, Math.floor(limit))))
  }
  return { ok: true, args }
}

/** 校验 export 命令的 outputFile 参数(NUL 字节/路径遍历/扩展名白名单)并组装参数后缀 */
export function buildExportFileArgs(outputFile?: string): CommandArgsResult {
  if (!outputFile) return { ok: true, args: [] }
  if (typeof outputFile !== 'string' || outputFile.length === 0) {
    return { ok: false, error: 'outputFile must be a non-empty string' }
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
  if (/\x00/.test(outputFile)) {
    return { ok: false, error: 'outputFile contains null bytes' }
  }
  // 路径遍历防护
  if (outputFile.includes('..')) {
    return { ok: false, error: 'outputFile contains path traversal characters' }
  }
  // 扩展名白名单(与 Rust 端实现对齐)
  const allowedExts = ['.csv', '.jsonl', '.html', '.json', '.txt']
  const ext = path.extname(outputFile).toLowerCase()
  if (ext && !allowedExts.includes(ext)) {
    return { ok: false, error: `outputFile extension not allowed: ${ext}` }
  }
  return { ok: true, args: ['--output-file', outputFile] }
}

/** 校验 import 命令的 filePath 参数(NUL 字节/路径遍历/扩展名白名单与 Rust 对齐)并组装参数 */
export function buildImportArgs(filePath: string): CommandArgsResult {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { ok: false, error: 'filePath must be a non-empty string' }
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
  if (/\x00/.test(filePath)) {
    return { ok: false, error: 'filePath contains null bytes' }
  }
  // 路径遍历防护
  if (filePath.includes('..')) {
    return { ok: false, error: 'filePath cannot contain path traversal (..)' }
  }
  // Rust 端只支持 JSON 格式导入(serde_json::from_str),白名单与 Rust 实现对齐
  const allowedExts = ['.json', '.jsonl']
  const ext = path.extname(filePath).toLowerCase()
  if (!allowedExts.includes(ext)) {
    return {
      ok: false,
      error: `file extension not supported: ${ext}, allowed: ${allowedExts.join(', ')}`,
    }
  }
  return { ok: true, args: [filePath] }
}

/** 校验 dashboard 命令的 outputDir 参数(NUL 字节/路径遍历防护)并组装参数 */
export function buildDashboardArgs(outputDir?: string): CommandArgsResult {
  const args: string[] = []
  if (outputDir) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
    if (/\x00/.test(outputDir)) {
      return { ok: false, error: 'outputDir contains null bytes' }
    }
    // 路径遍历防护: 拒绝含 .. 的路径
    if (outputDir.includes('..')) {
      return { ok: false, error: 'outputDir cannot contain path traversal (..)' }
    }
    args.push('--output-dir', outputDir)
  }
  return { ok: true, args }
}
