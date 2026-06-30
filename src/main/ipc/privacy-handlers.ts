// =============================================================
// 隐私引擎 IPC 处理器
// - Init/Load/Disable: Rust CLI 要求密码作为**位置参数**传递
//   渲染进程仅在 init/load 时发送一次密码(明文,因 Rust CLI 需要),
//   主进程在内存中保留密码(eaaBridge.setPrivacyPassword)供后续命令复用,
//   渲染进程随后清空自身密码状态,避免长期持有
// - Add/List/Anonymize/Deanonymize/Filter/DryRun: 密码走 EAA_PRIVACY_PASSWORD 环境变量,
//   渲染进程不再需要重复传递密码
// - Lock/Status: 显式锁定(清空内存密码)与状态查询
// - 入参 sanitize(防命令注入)
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

export function registerPrivacyHandlers(_win: BrowserWindow) {
  // ----- init: 初始化隐私引擎（Rust CLI 要求 password 作为位置参数） -----
  // 渲染进程发送一次密码后,主进程在内存中保留,渲染进程应立即清空自身状态
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

  // ----- enable: 启用脱敏（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_ENABLE, async () => {
    return eaaBridge.execute({ command: 'privacy', args: ['enable'] })
  })

  // ----- disable: 禁用脱敏（Rust CLI 要求 password 作为位置参数） -----
  ipcMain.handle(IPC.IPC_PRIVACY_DISABLE, async (_e, password: string) => {
    const pwd = validatePassword(password)
    eaaBridge.setPrivacyPassword(pwd)
    return eaaBridge.execute({ command: 'privacy', args: ['disable', pwd] })
  })

  // ----- list: 列出已注册实体（密码走 EAA_PRIVACY_PASSWORD 环境变量,内存中已缓存） -----
  // 兼容旧调用：如果渲染进程仍传密码,则更新内存中的密码；否则使用已缓存的
  ipcMain.handle(IPC.IPC_PRIVACY_LIST, async (_e, password?: string) => {
    if (typeof password === 'string' && password.length >= 4) {
      eaaBridge.setPrivacyPassword(password)
    }
    return eaaBridge.execute({ command: 'privacy', args: ['list'], jsonOutput: true })
  })

  // ----- add: 添加隐私实体（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_ADD, async (_e, entityType: string, text: string) => {
    const safeType = sanitizeEnum(entityType, ENTITY_TYPES, 'entityType')
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({
      command: 'privacy',
      args: ['add', '--entity', safeType, '--text', safeText],
    })
  })

  // ----- anonymize: 文本脱敏（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_ANONYMIZE, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['anonymize', safeText] })
  })

  // ----- deanonymize: 文本反脱敏（需要环境变量中的密码,内存中已缓存） -----
  ipcMain.handle(IPC.IPC_PRIVACY_DEANONYMIZE, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['deanonymize', safeText] })
  })

  // ----- filter: 按接收者过滤（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_FILTER, async (_e, receiver: string, text: string) => {
    const safeReceiver = sanitizeEnum(receiver, RECEIVER_TYPES, 'receiver')
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({
      command: 'privacy',
      args: ['filter', '--receiver', safeReceiver, safeText],
    })
  })

  // ----- dry-run: 预览脱敏效果（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_DRYRUN, async (_e, text: string) => {
    const safeText = sanitize(text, 'text')
    return eaaBridge.execute({ command: 'privacy', args: ['dry-run', safeText] })
  })

  // ----- backup: 备份隐私库（使用内存中已缓存的密码） -----
  ipcMain.handle(IPC.IPC_PRIVACY_BACKUP, async (_e, destPath: string) => {
    const safePath = sanitize(destPath, 'destPath', 1024)
    if (safePath.includes('\0')) {
      throw new Error('destPath contains null bytes')
    }
    return eaaBridge.execute({ command: 'privacy', args: ['backup', safePath] })
  })

  // ----- lock: 锁定隐私引擎（清空内存中的密码,后续命令将无法使用隐私功能） -----
  // 渲染进程调用此方法后,需要重新输入密码才能继续使用隐私功能
  ipcMain.handle(IPC.IPC_PRIVACY_LOCK, async () => {
    eaaBridge.clearPrivacyPassword()
    return { success: true }
  })

  // ----- status: 查询隐私引擎状态（是否已加载密码,是否已初始化） -----
  // 不返回密码本身,只返回布尔状态
  ipcMain.handle(IPC.IPC_PRIVACY_STATUS, async () => {
    return {
      unlocked: eaaBridge.hasPrivacyPassword(),
    }
  })

  console.log('[IPC] Privacy handlers registered (with lock/status)')
}
