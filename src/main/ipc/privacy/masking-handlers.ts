// =============================================================
// 隐私引擎脱敏 handler — list/add/dryrun/backup
// (密码走内存缓存/环境变量)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { eaaBridge } from '../../services/eaa-bridge'
import { ENTITY_TYPES, sanitize, sanitizeEnum, validatePassword } from './params'

export function registerPrivacyMaskingHandlers(): void {
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
  // (避免 IPC 层抛异常)
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
}
