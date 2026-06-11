// =============================================================
// 隐私引擎 IPC 处理器
// - Init/Load/Disable: Rust CLI 要求密码作为**位置参数**传递
// - Add/List/Anonymize/Deanonymize/Filter/DryRun: 密码走 EAA_PRIVACY_PASSWORD 环境变量
// - 入参 sanitize（防命令注入）
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { eaaBridge } from '../services/eaa-bridge'

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

const ENTITY_TYPES = ['person', 'place', 'org', 'phone', 'email', 'id_card', 'student_id'] as const
const RECEIVER_TYPES = ['student', 'parent', 'teacher', 'school', 'public'] as const

export function registerPrivacyHandlers(win: BrowserWindow) {
  // ----- init: 初始化隐私引擎（Rust CLI 要求 password 作为位置参数） -----
  ipcMain.handle(IPC.IPC_PRIVACY_INIT, async (_e, password: string, autoScan?: boolean) => {
    const pwd = validatePassword(password)
    eaaBridge.setPrivacyPassword(pwd)
    const args: string[] = [pwd]
    if (autoScan) args.push('--auto-scan')
    return eaaBridge.execute({ command: 'privacy', args: ['init', ...args] })
  })

  // ----- load: 加载已存在的隐私库（Rust CLI 要求 password 作为位置参数） -----
  ipcMain.handle(IPC.IPC_PRIVACY_LOAD, async (_e, password: string) => {
    const pwd = validatePassword(password)
    eaaBridge.setPrivacyPassword(pwd)
    return eaaBridge.execute({ command: 'privacy', args: ['load', pwd] })
  })

  // ----- enable: 启用脱敏 -----
  // P1-7/1.8: 成功后向渲染端广播状态变化（用于全局徽章 + usePrivacyFilter 自动刷新）
  ipcMain.handle(IPC.IPC_PRIVACY_ENABLE, async () => {
    const result = await eaaBridge.execute({ command: 'privacy', args: ['enable'] })
    if (result.success) {
      win.webContents.send(IPC.IPC_PRIVACY_STATE_CHANGED, { enabled: true, at: Date.now() })
    }
    return result
  })

  // ----- disable: 禁用脱敏（Rust CLI 要求 password 作为位置参数） -----
  // P1-7/1.8: 成功后向渲染端广播状态变化
  ipcMain.handle(IPC.IPC_PRIVACY_DISABLE, async (_e, password: string) => {
    const pwd = validatePassword(password)
    eaaBridge.setPrivacyPassword(pwd)
    const result = await eaaBridge.execute({ command: 'privacy', args: ['disable', pwd] })
    if (result.success) {
      win.webContents.send(IPC.IPC_PRIVACY_STATE_CHANGED, { enabled: false, at: Date.now() })
    }
    return result
  })

  // ----- list: 列出已注册实体（密码走 EAA_PRIVACY_PASSWORD 环境变量） -----
  ipcMain.handle(IPC.IPC_PRIVACY_LIST, async (_e, password?: string) => {
    if (typeof password === 'string' && password.length >= 4) {
      eaaBridge.setPrivacyPassword(password)
    }
    return eaaBridge.execute({ command: 'privacy', args: ['list'], jsonOutput: true })
  })

  // ----- add: 添加隐私实体 -----
  ipcMain.handle(IPC.IPC_PRIVACY_ADD, async (_e, entityType: string, text: string) => {
    const safeType = sanitizeEnum(entityType, ENTITY_TYPES, 'entityType')
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({
      command: 'privacy',
      args: ['add', '--entity', safeType, '--text', safeText],
    })
  })

  // ----- anonymize: 文本脱敏 -----
  ipcMain.handle(IPC.IPC_PRIVACY_ANONYMIZE, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['anonymize', safeText] })
  })

  // ----- deanonymize: 文本反脱敏（需要环境变量中的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_DEANONYMIZE, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['deanonymize', safeText] })
  })

  // ----- filter: 按接收者过滤 -----
  ipcMain.handle(IPC.IPC_PRIVACY_FILTER, async (_e, receiver: string, text: string) => {
    const safeReceiver = sanitizeEnum(receiver, RECEIVER_TYPES, 'receiver')
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({
      command: 'privacy',
      args: ['filter', '--receiver', safeReceiver, safeText],
    })
  })

  // ----- dry-run: 预览脱敏效果 -----
  ipcMain.handle(IPC.IPC_PRIVACY_DRYRUN, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['dry-run', safeText] })
  })

  // ----- backup: 备份隐私库 -----
  ipcMain.handle(IPC.IPC_PRIVACY_BACKUP, async (_e, destPath: string) => {
    const safePath = sanitize(destPath, 'destPath', 1024)
    if (safePath.includes('\0')) {
      throw new Error('destPath contains null bytes')
    }
    return eaaBridge.execute({ command: 'privacy', args: ['backup', safePath] })
  })

  console.log('[IPC] Privacy handlers registered')
}
