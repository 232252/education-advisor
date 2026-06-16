// =============================================================
// Privacy Audit — 隐私引擎调用的审计日志(JSONL 追加写)
//
// 目的:
//   - Pillar 6 合规报告的数据源
//   - 记录每一次 privacy 操作(timestamp / op / input / output / recipient / PII 命中数)
//   - JSONL 格式:每行一条,易追加、易 grep、易哈希
//   - 失败安全:写入失败**只警告不抛错**(审计不应阻塞主流程)
//
// 存盘位置:
//   - <userData>/eaa-data/privacy/audit.jsonl
//   - 与 mapping.enc 同目录,运维时一目了然
//
// 隐私:
//   - 绝不写入明文 PII 文本(只记 inputLen / outputLen / piiCount)
//   - 符合 "PII 不会落盘" 的核心承诺
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

/** 单条审计记录(不包含明文) */
export interface PrivacyAuditEntry {
  /** Unix ms */
  ts: number
  /** 操作类型 */
  op: PrivacyAuditOp
  /** 输入文本长度(字节,非字符) */
  inputLen: number
  /** 输出文本长度 */
  outputLen: number
  /** 是否检测到 PII */
  hasPII: boolean
  /** 命中 PII 数(化名占位符计数) */
  piiCount: number
  /** 接收者(仅 filter 操作) */
  receiver?: string
  /** 实体类型(仅 add 操作) */
  entityType?: string
  /** 调用耗时 ms */
  durationMs: number
  /** 是否成功 */
  success: boolean
  /** 错误信息(success=false 时) */
  error?: string
}

export type PrivacyAuditOp =
  | 'init'
  | 'load'
  | 'enable'
  | 'disable'
  | 'add'
  | 'list'
  | 'anonymize'
  | 'deanonymize'
  | 'filter'
  | 'dry-run'
  | 'backup'

let AUDIT_DIR: string | null = null
let AUDIT_FILE: string | null = null

function getAuditPath(): string {
  if (AUDIT_FILE) return AUDIT_FILE
  const dataDir = path.join(app.getPath('userData'), 'eaa-data')
  AUDIT_DIR = path.join(dataDir, 'privacy')
  AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl')
  return AUDIT_FILE
}

/**
 * 写一条审计记录(失败安全)
 * - 不抛错,只 console.warn
 * - 父目录自动创建
 */
export async function logAudit(entry: Omit<PrivacyAuditEntry, 'ts'>): Promise<void> {
  try {
    const file = getAuditPath()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const full: PrivacyAuditEntry = { ts: Date.now(), ...entry }
    await fsp.appendFile(file, JSON.stringify(full) + '\n', 'utf-8')
  } catch (err) {
    // 失败安全:写不进审计不应阻塞主流程
    console.warn(
      `[privacy-audit] failed to write audit entry: ${err instanceof Error ? err.message : err}`,
    )
  }
}

/**
 * 读全部审计记录(时间倒序可选)
 * - 损坏的行**跳过**(不抛错)
 * - 返回浅拷贝,避免外部篡改
 */
export async function readAudit(opts?: {
  start?: number
  end?: number
  op?: PrivacyAuditOp
  limit?: number
}): Promise<PrivacyAuditEntry[]> {
  const file = getAuditPath()
  let raw = ''
  try {
    raw = await fsp.readFile(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: PrivacyAuditEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as PrivacyAuditEntry
      if (opts?.start !== undefined && e.ts < opts.start) continue
      if (opts?.end !== undefined && e.ts > opts.end) continue
      if (opts?.op && e.op !== opts.op) continue
      out.push(e)
    } catch {
      // 损坏行跳过(append-only 模式,损坏=磁盘问题,不影响其他行)
    }
  }
  // 默认按时间倒序(最近的在前)
  out.sort((a, b) => b.ts - a.ts)
  if (opts?.limit) return out.slice(0, opts.limit)
  return out
}

/**
 * 读原始文本(用于 SHA-256 计算)
 * - 失败抛错(由调用方决定)
 */
export async function readAuditRaw(): Promise<string> {
  const file = getAuditPath()
  try {
    return await fsp.readFile(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

/**
 * 行数统计
 */
export async function countAuditLines(): Promise<number> {
  const raw = await readAuditRaw()
  if (!raw) return 0
  return raw.split('\n').filter((l) => l.trim()).length
}

/**
 * 清空审计日志(危险操作,需要 explicit 标志)
 * - 用于"开始新季度"时归档旧日志
 * - 不推荐无脑调用
 */
export async function clearAudit(opts: { explicit: true; backupTo?: string }): Promise<void> {
  if (!opts.explicit) {
    throw new Error('clearAudit requires { explicit: true }')
  }
  const file = getAuditPath()
  if (opts.backupTo) {
    const raw = await readAuditRaw()
    await fsp.writeFile(opts.backupTo, raw, 'utf-8')
  }
  await fsp.unlink(file)
}

/** 同步版本用于初始化阶段(读 file size) */
export function auditFileExistsSync(): boolean {
  try {
    return fs.existsSync(getAuditPath())
  } catch {
    return false
  }
}

export const PRIVACY_AUDIT_FILE_NAME = 'audit.jsonl'
