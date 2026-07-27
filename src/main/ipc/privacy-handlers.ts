// =============================================================
// 隐私引擎 IPC 处理器
// - Init/Load/Disable: Rust CLI 要求密码作为**位置参数**传递
//   渲染进程仅在 init/load 时发送一次密码(明文,因 Rust CLI 需要),
//   主进程在内存中保留密码(eaaBridge.setPrivacyPassword)供后续命令复用,
//   渲染进程随后清空自身密码状态,避免长期持有
// - Add/List/Anonymize/Deanonymize/Filter/DryRun: 密码走 EAA_PRIVACY_PASSWORD 环境变量,
//   渲染进程不再需要重复传递密码
// - Lock/Unlock/Status: 显式锁定(清空内存密码)、解锁(重新输入密码)与状态查询
// - 入参 sanitize(防命令注入)
//
// 安全改进(从 Tauri 版本回迁):
//   R30-1: lock 状态下不允许 enable,防止隐私保护失效
//   R37-1: lock 状态下不允许 list/anonymize/deanonymize/filter/dryrun/backup,避免泄露
//   R37-2: 新增 unlock handler,此前 lock 后无解锁路径
//   R41-1/R41-2: anonymize/deanonymize/filter/dryrun 加 try-catch 兜底,转结构化错误
//   v3.2.9: init/load/disable 仅在 CLI 真正成功时才修改密码缓存
//           (EAA CLI 失败时返回 exitCode=0 + success=true + data 含 ❌)
// =============================================================

import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
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
  // v3.2.9 修复: 仅在 CLI 真正成功时才缓存密码,避免初始化失败后 status 误报 unlocked=true
  // 注意: EAA CLI 对 privacy load/init 失败时仍返回 exitCode=0 + success=true,
  //       错误信息在 data 字段中以 "❌" 开头,所以需要额外检查 data 内容
  // R81 修复: 包裹 try-catch, 把 validatePassword 抛错转结构化错误 (与 unlock/add 等处理器一致)
  ipcMain.handle(
    IPC.IPC_PRIVACY_INIT,
    async (_e: IpcMainInvokeEvent, password: string, autoScan?: boolean) => {
      try {
        const pwd = validatePassword(password)
        const args: string[] = [pwd]
        if (autoScan) args.push('--auto-scan')
        const result = await eaaBridge.execute({ command: 'privacy', args: ['init', ...args] })
        // 仅当 CLI 成功且 data 不包含错误标记时才缓存密码
        const isRealSuccess =
          result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
        if (isRealSuccess) {
          eaaBridge.setPrivacyPassword(pwd)
        }
        return result
      } catch (err) {
        return { success: false, data: err instanceof Error ? err.message : 'init 失败' }
      }
    },
  )

  // ----- load: 加载已存在的隐私库（Rust CLI 要求 password 作为位置参数） -----
  // v3.2.9 修复: 仅在 CLI 真正成功时才缓存密码,避免密码错误时 status 误报 unlocked=true
  // R81 修复: 包裹 try-catch, 把 validatePassword 抛错转结构化错误
  ipcMain.handle(IPC.IPC_PRIVACY_LOAD, async (_e: IpcMainInvokeEvent, password: string) => {
    try {
      const pwd = validatePassword(password)
      const result = await eaaBridge.execute({ command: 'privacy', args: ['load', pwd] })
      // 仅当 CLI 成功且 data 不包含错误标记时才缓存密码
      const isRealSuccess =
        result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
      if (isRealSuccess) {
        eaaBridge.setPrivacyPassword(pwd)
      }
      return result
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'load 失败' }
    }
  })

  // ----- enable: 启用脱敏（使用内存中已缓存的密码） -----
  // R30-1 修复: lock 状态下(无密码)不应允许 enable, 防止隐私保护失效
  ipcMain.handle(IPC.IPC_PRIVACY_ENABLE, async () => {
    if (!eaaBridge.hasPrivacyPassword()) {
      return {
        success: false,
        data: '隐私引擎已锁定,请先输入密码解锁后再启用脱敏',
        stderr: 'Privacy engine is locked, password required',
        exitCode: 1,
      }
    }
    return eaaBridge.execute({ command: 'privacy', args: ['enable'] })
  })

  // ----- disable: 禁用脱敏（Rust CLI 要求 password 作为位置参数） -----
  // v3.2.9 修复: 仅在 CLI 真正成功时清空内存密码;失败时保持原密码缓存不变
  // R81 修复: 包裹 try-catch, 把 validatePassword 抛错转结构化错误
  ipcMain.handle(IPC.IPC_PRIVACY_DISABLE, async (_e: IpcMainInvokeEvent, password: string) => {
    try {
      const pwd = validatePassword(password)
      const result = await eaaBridge.execute({ command: 'privacy', args: ['disable', pwd] })
      const isRealSuccess =
        result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
      if (isRealSuccess) {
        eaaBridge.clearPrivacyPassword()
      }
      return result
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'disable 失败' }
    }
  })

  // ----- list: 列出已注册实体（密码走 EAA_PRIVACY_PASSWORD 环境变量,内存中已缓存） -----
  // 兼容旧调用：如果渲染进程仍传密码,则更新内存中的密码；否则使用已缓存的
  // 修复: 统一用 validatePassword 校验,避免弱密码静默通过(原仅检查 length>=4)
  // R37-1 修复: lock 状态下(无密码且未传新密码)不允许 list，避免泄露实体映射
  // v3.2.9 修复: 传入新密码时,仅在 CLI 真正成功后才缓存;失败则恢复原状态
  ipcMain.handle(IPC.IPC_PRIVACY_LIST, async (_e: IpcMainInvokeEvent, password?: string) => {
    const hadPassword = eaaBridge.hasPrivacyPassword()
    if (password !== undefined && password !== null) {
      const pwd = validatePassword(password)
      eaaBridge.setPrivacyPassword(pwd)
    }
    if (!eaaBridge.hasPrivacyPassword()) {
      return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再列出实体' }
    }
    const result = await eaaBridge.execute({ command: 'privacy', args: ['list'], jsonOutput: true })
    // v3.2.9: 如果传了新密码但 CLI 失败,且之前没有缓存密码,则清空避免误报 unlocked
    if (password !== undefined && password !== null) {
      const isRealSuccess =
        result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
      if (!isRealSuccess && !hadPassword) {
        eaaBridge.clearPrivacyPassword()
      }
    }
    return result
  })

  // ----- add: 添加隐私实体（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 add
  // R74-1 修复: try-catch 兜底, 把 sanitize/sanitizeEnum 抛错转结构化错误
  // (与 anonymize/deanonymize/filter 一致, 避免 IPC 层抛异常)
  ipcMain.handle(
    IPC.IPC_PRIVACY_ADD,
    async (_e: IpcMainInvokeEvent, entityType: string, text: string) => {
      if (!eaaBridge.hasPrivacyPassword()) {
        return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再添加实体' }
      }
      try {
        const safeType = sanitizeEnum(entityType, ENTITY_TYPES, 'entityType')
        const safeText = sanitize(text, 'text')
        return await eaaBridge.execute({
          command: 'privacy',
          args: ['add', '--entity', safeType, '--text', safeText],
        })
      } catch (err) {
        return { success: false, data: err instanceof Error ? err.message : 'add 失败' }
      }
    },
  )

  // ----- anonymize: 文本脱敏（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 anonymize，避免静默泄露原文
  // R41-1 修复: try-catch 兜底，把 EAA CLI 的 throw（如 "text too long"）转结构化错误
  // R41-2 修复: sanitize() 对超长输入也同步 throw，需把 sanitize 调用一并纳入 try 块
  ipcMain.handle(IPC.IPC_PRIVACY_ANONYMIZE, async (_e: IpcMainInvokeEvent, text: string) => {
    if (!eaaBridge.hasPrivacyPassword()) {
      return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再脱敏' }
    }
    try {
      const safeText = sanitize(text, 'text')
      return await eaaBridge.execute({ command: 'privacy', args: ['anonymize', safeText] })
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'anonymize 失败' }
    }
  })

  // ----- deanonymize: 文本反脱敏（需要环境变量中的密码,内存中已缓存） -----
  // R37-1 修复: lock 状态下不允许 deanonymize
  // R41-1 修复: try-catch 兜底，转结构化错误
  ipcMain.handle(IPC.IPC_PRIVACY_DEANONYMIZE, async (_e: IpcMainInvokeEvent, text: string) => {
    if (!eaaBridge.hasPrivacyPassword()) {
      return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再反脱敏' }
    }
    try {
      const safeText = sanitize(text, 'text')
      return await eaaBridge.execute({ command: 'privacy', args: ['deanonymize', safeText] })
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'deanonymize 失败' }
    }
  })

  // ----- filter: 按接收者过滤（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 filter
  // R41-1 修复: try-catch 兜底，转结构化错误
  ipcMain.handle(
    IPC.IPC_PRIVACY_FILTER,
    async (_e: IpcMainInvokeEvent, receiver: string, text: string) => {
      if (!eaaBridge.hasPrivacyPassword()) {
        return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再过滤' }
      }
      try {
        const safeReceiver = sanitizeEnum(receiver, RECEIVER_TYPES, 'receiver')
        const safeText = sanitize(text, 'text')
        return await eaaBridge.execute({
          command: 'privacy',
          args: ['filter', '--receiver', safeReceiver, safeText],
        })
      } catch (err) {
        return { success: false, data: err instanceof Error ? err.message : 'filter 失败' }
      }
    },
  )

  // ----- dry-run: 预览脱敏效果（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 dry-run
  // R41-1 修复: try-catch 兜底，转结构化错误
  ipcMain.handle(IPC.IPC_PRIVACY_DRYRUN, async (_e: IpcMainInvokeEvent, text: string) => {
    if (!eaaBridge.hasPrivacyPassword()) {
      return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再预览' }
    }
    try {
      const safeText = sanitize(text, 'text')
      return await eaaBridge.execute({ command: 'privacy', args: ['dry-run', safeText] })
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'dry-run 失败' }
    }
  })

  // ----- backup: 备份隐私库（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 backup，避免泄露隐私库内容
  // R75 修复: try-catch 兜底, 把 sanitize/path 校验抛错转结构化错误
  // (与 add/anonymize/filter 等处理器的错误处理风格一致)
  ipcMain.handle(IPC.IPC_PRIVACY_BACKUP, async (_e: IpcMainInvokeEvent, destPath: string) => {
    if (!eaaBridge.hasPrivacyPassword()) {
      return { success: false, data: '隐私引擎已锁定，请先输入密码解锁后再备份' }
    }
    try {
      const safePath = sanitize(destPath, 'destPath', 1024)
      if (safePath.includes('\0')) {
        return { success: false, data: 'destPath contains null bytes' }
      }
      // 路径遍历防护: 拒绝含 .. 的路径,防止备份文件写入系统目录
      if (safePath.includes('..')) {
        return { success: false, data: 'destPath cannot contain path traversal (..)' }
      }
      return await eaaBridge.execute({ command: 'privacy', args: ['backup', safePath] })
    } catch (err) {
      return { success: false, data: err instanceof Error ? err.message : 'backup 失败' }
    }
  })

  // ----- unlock: 解锁隐私引擎（重新输入密码，校验后缓存到内存） -----
  // R37-2 修复: 新增 unlock handler，之前 lock 后无解锁路径，privacy.unlock() 返回空对象
  // 解锁逻辑：校验密码长度格式后缓存到内存，真正校验密码正确性由后续 EAA CLI 命令执行
  // （若密码错误，下一次 anonymize 等命令会返回 EAA CLI 的错误）
  ipcMain.handle(IPC.IPC_PRIVACY_UNLOCK, async (_e: IpcMainInvokeEvent, password: string) => {
    try {
      const pwd = validatePassword(password)
      eaaBridge.setPrivacyPassword(pwd)
      return { success: true, data: '隐私引擎已解锁' }
    } catch (err) {
      return {
        success: false,
        data: err instanceof Error ? err.message : '解锁失败，密码格式不合法',
      }
    }
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

  console.log('[IPC] Privacy handlers registered (with lock/unlock/status)')
}
