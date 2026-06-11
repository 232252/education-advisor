// =============================================================
// 隐私引擎 IPC 处理器
// - Init/Load/Disable: Rust CLI 要求密码作为**位置参数**传递
// - Add/List/Anonymize/Deanonymize/Filter/DryRun: 密码走 EAA_PRIVACY_PASSWORD 环境变量
// - 入参 sanitize（防命令注入）
// - Pillar 6: 每次隐私操作都写一条审计日志(JSONL,append-only)
//   用于季度合规报告生成
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import {
  buildReport as buildReportFromEntries,
  generateComplianceReport,
  previousQuarterRange,
  quarterRange,
} from '../services/compliance-report'
import { eaaBridge } from '../services/eaa-bridge'
import {
  countAuditLines,
  logAudit,
  type PrivacyAuditEntry,
  type PrivacyAuditOp,
  readAudit,
} from '../services/privacy-audit'

/** 密码校验：必须是非空字符串，长度 4-128 */
function validatePassword(password: unknown): string {
  if (typeof password !== 'string') {
    throw new Error('password must be a string')
  }
  if (password.length < 4 || password.length > 128) {
    throw new Error('password length must be 4-128 chars')
  }
  return password
}

/** 通用字符串 sanitize：剥离不可见字符，拒绝危险输入 */
function sanitize(input: unknown, field: string, max = 4096): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  if (input.length === 0) {
    throw new Error(`${field} cannot be empty`)
  }
  if (input.length > max) {
    throw new Error(`${field} too long (max ${max} chars)`)
  }
  // 剥离不可见 Unicode 字符（零宽空格、BOM、软连字符等），保留正常文本
  const cleaned = input
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .replace(/\r\n/g, '\n') // 统一换行
    .trim()
  if (cleaned.length === 0) {
    throw new Error(`${field} is empty after cleaning`)
  }
  // 仅拒绝 NUL 字节（唯一真正危险的控制字符）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
  if (/\x00/.test(cleaned)) {
    throw new Error(`${field} contains null bytes`)
  }
  if (cleaned.startsWith('--')) {
    throw new Error(`${field} cannot start with --`)
  }
  return cleaned
}

/** 限定枚举 sanitize */
function sanitizeEnum<T extends string>(input: unknown, allowed: readonly T[], field: string): T {
  if (typeof input !== 'string' || !(allowed as readonly string[]).includes(input)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return input as T
}

/** 计算脱敏输出中的 PII 化名标记数量(粗略) */
function countPIIInOutput(output: string): number {
  if (!output) return 0
  const matches = output.match(/\b(?:S|P|T|ADDR|PH|ID|SCH)_\d{2,}\b/g)
  return matches?.length ?? 0
}

const ENTITY_TYPES = ['person', 'place', 'org', 'phone', 'email', 'id_card', 'student_id'] as const
const RECEIVER_TYPES = ['student', 'parent', 'teacher', 'school', 'public'] as const

/**
 * 提取 eaaBridge.execute 的输出字符串(兼容多种返回结构)
 */
function extractOutput(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const data = (result as { data?: unknown }).data
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const obj = data as { output?: string; redacted?: string }
    return obj.output ?? obj.redacted ?? ''
  }
  return ''
}

export function registerPrivacyHandlers(win: BrowserWindow) {
  // ----- init -----
  ipcMain.handle(IPC.IPC_PRIVACY_INIT, async (_e, password: string, autoScan?: boolean) => {
    const start = Date.now()
    try {
      const pwd = validatePassword(password)
      eaaBridge.setPrivacyPassword(pwd)
      const args: string[] = [pwd]
      if (autoScan) args.push('--auto-scan')
      const result = await eaaBridge.execute({ command: 'privacy', args: ['init', ...args] })
      await logAudit({
        op: 'init',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean((result as { success?: boolean } | null)?.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'init',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- load -----
  ipcMain.handle(IPC.IPC_PRIVACY_LOAD, async (_e, password: string) => {
    const start = Date.now()
    try {
      const pwd = validatePassword(password)
      eaaBridge.setPrivacyPassword(pwd)
      const result = await eaaBridge.execute({ command: 'privacy', args: ['load', pwd] })
      await logAudit({
        op: 'load',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean((result as { success?: boolean } | null)?.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'load',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- enable -----
  ipcMain.handle(IPC.IPC_PRIVACY_ENABLE, async () => {
    const start = Date.now()
    try {
      const result = await eaaBridge.execute({ command: 'privacy', args: ['enable'] })
      if (result.success) {
        win.webContents.send(IPC.IPC_PRIVACY_STATE_CHANGED, { enabled: true, at: Date.now() })
      }
      await logAudit({
        op: 'enable',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'enable',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- disable -----
  ipcMain.handle(IPC.IPC_PRIVACY_DISABLE, async (_e, password: string) => {
    const start = Date.now()
    try {
      const pwd = validatePassword(password)
      eaaBridge.setPrivacyPassword(pwd)
      const result = await eaaBridge.execute({ command: 'privacy', args: ['disable', pwd] })
      if (result.success) {
        win.webContents.send(IPC.IPC_PRIVACY_STATE_CHANGED, { enabled: false, at: Date.now() })
      }
      await logAudit({
        op: 'disable',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'disable',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- list -----
  ipcMain.handle(IPC.IPC_PRIVACY_LIST, async (_e, password?: string) => {
    const start = Date.now()
    try {
      if (typeof password === 'string' && password.length >= 4) {
        eaaBridge.setPrivacyPassword(password)
      }
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['list'],
        jsonOutput: true,
      })
      await logAudit({
        op: 'list',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'list',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- add -----
  ipcMain.handle(IPC.IPC_PRIVACY_ADD, async (_e, entityType: string, text: string) => {
    const start = Date.now()
    let safeType = ''
    try {
      safeType = sanitizeEnum(entityType, ENTITY_TYPES, 'entityType')
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['add', '--entity', safeType, '--text', safeText],
      })
      await logAudit({
        op: 'add',
        inputLen: safeText.length,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        entityType: safeType,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'add',
        inputLen: typeof text === 'string' ? text.length : 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        entityType: safeType || (typeof entityType === 'string' ? entityType : '?'),
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- anonymize -----
  ipcMain.handle(IPC.IPC_PRIVACY_ANONYMIZE, async (_e, text: string) => {
    const start = Date.now()
    try {
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['anonymize', safeText],
      })
      const output = extractOutput(result)
      const piiCount = countPIIInOutput(output)
      await logAudit({
        op: 'anonymize',
        inputLen: safeText.length,
        outputLen: output.length,
        hasPII: piiCount > 0 || safeText !== output,
        piiCount,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'anonymize',
        inputLen: typeof text === 'string' ? text.length : 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- deanonymize -----
  ipcMain.handle(IPC.IPC_PRIVACY_DEANONYMIZE, async (_e, text: string) => {
    const start = Date.now()
    try {
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['deanonymize', safeText],
      })
      const output = extractOutput(result)
      const piiCount = countPIIInOutput(output)
      await logAudit({
        op: 'deanonymize',
        inputLen: safeText.length,
        outputLen: output.length,
        hasPII: piiCount > 0 || safeText !== output,
        piiCount,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'deanonymize',
        inputLen: typeof text === 'string' ? text.length : 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- filter -----
  ipcMain.handle(IPC.IPC_PRIVACY_FILTER, async (_e, receiver: string, text: string) => {
    const start = Date.now()
    let safeReceiver = ''
    try {
      safeReceiver = sanitizeEnum(receiver, RECEIVER_TYPES, 'receiver')
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['filter', '--receiver', safeReceiver, safeText],
      })
      const output = extractOutput(result)
      const piiCount = countPIIInOutput(output)
      await logAudit({
        op: 'filter',
        inputLen: safeText.length,
        outputLen: output.length,
        hasPII: piiCount > 0 || safeText !== output,
        piiCount,
        receiver: safeReceiver,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'filter',
        inputLen: typeof text === 'string' ? text.length : 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        receiver: safeReceiver || (typeof receiver === 'string' ? receiver : '?'),
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- dry-run -----
  ipcMain.handle(IPC.IPC_PRIVACY_DRYRUN, async (_e, text: string) => {
    const start = Date.now()
    try {
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['dry-run', safeText],
      })
      const output = extractOutput(result)
      const piiCount = countPIIInOutput(output)
      await logAudit({
        op: 'dry-run',
        inputLen: safeText.length,
        outputLen: output.length,
        hasPII: piiCount > 0 || safeText !== output,
        piiCount,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'dry-run',
        inputLen: typeof text === 'string' ? text.length : 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ----- backup -----
  ipcMain.handle(IPC.IPC_PRIVACY_BACKUP, async (_e, destPath: string) => {
    const start = Date.now()
    try {
      const safePath = sanitize(destPath, 'destPath', 1024)
      if (safePath.includes('\0')) {
        throw new Error('destPath contains null bytes')
      }
      const result = await eaaBridge.execute({ command: 'privacy', args: ['backup', safePath] })
      await logAudit({
        op: 'backup',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: Boolean(result.success),
      })
      return result
    } catch (err) {
      await logAudit({
        op: 'backup',
        inputLen: 0,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })

  // ============================================================
  // Pillar 6: 合规报告 IPC
  // ============================================================

  // ----- generate: 生成报告(JSON 形态,带 SHA-256 清单) -----
  ipcMain.handle(
    IPC.IPC_COMPLIANCE_GENERATE,
    async (_e, startMs: number, endMs: number, label?: string) => {
      const numStart = Number(startMs)
      const numEnd = Number(endMs)
      if (!Number.isFinite(numStart) || !Number.isFinite(numEnd)) {
        return { success: false, error: 'start/end must be numbers' }
      }
      if (numStart >= numEnd) {
        return { success: false, error: 'start must be < end' }
      }
      const report = await generateComplianceReport({
        start: numStart,
        end: numEnd,
        label: typeof label === 'string' ? label : undefined,
      })
      return { success: true, report }
    },
  )

  // ----- list: 列出已生成的报告 + 默认时间范围(上一季度) -----
  ipcMain.handle(IPC.IPC_COMPLIANCE_LIST, async () => {
    const totalLines = await countAuditLines()
    const prev = previousQuarterRange()
    return {
      success: true,
      auditLogLineCount: totalLines,
      previousQuarter: prev,
      currentQuarter: quarterRange(
        new Date().getUTCFullYear(),
        (Math.floor(new Date().getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4,
      ),
    }
  })

  // ----- save: 把报告 JSON 写入用户指定文件 -----
  ipcMain.handle(IPC.IPC_COMPLIANCE_SAVE, async (_e, reportJson: string, destPath: string) => {
    if (typeof reportJson !== 'string' || reportJson.length === 0) {
      return { success: false, error: 'reportJson must be a non-empty string' }
    }
    const safePath = sanitize(destPath, 'destPath', 1024)
    if (safePath.includes('\0')) {
      return { success: false, error: 'destPath contains null bytes' }
    }
    const fs = await import('node:fs/promises')
    await fs.writeFile(safePath, reportJson, 'utf-8')
    return { success: true, filePath: safePath, bytes: reportJson.length }
  })

  // ----- 同步入口: 拉取审计日志(供 UI 实时预览) -----
  ipcMain.handle('compliance:read-audit', async (_e, opts?: { limit?: number }) => {
    const entries = await readAudit({ limit: opts?.limit })
    return { success: true, entries }
  })

  console.log('[IPC] Privacy handlers registered')
}

export type { PrivacyAuditEntry, PrivacyAuditOp }
// 重新导出 buildReport 供单测和外部使用
export { buildReportFromEntries }
