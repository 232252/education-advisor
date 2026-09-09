// =============================================================
// 隐私引擎脱敏 handler — list/add/dryrun/backup
// (密码走内存缓存/环境变量)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { IpcMainInvokeEvent } from 'electron'
import { invalidatePrivacyGuardCache } from '../../services/agent/privacy-guard'
import { eaaBridge } from '../../services/eaa-bridge'
import { validatePathSafety } from '../../utils/sanitize'
import { handleIpc } from '../handle'
import { ENTITY_TYPES, sanitize, sanitizeEnum, validatePassword } from './params'

/** R37-1 解锁守卫的单一文案来源(此前逐字 4 份,仅动作名不同) */
function lockedResult(action: string): { success: false; data: string } {
  return { success: false, data: `隐私引擎已锁定，请先输入密码解锁后再${action}` }
}

/** handleIpc onError 形状单一来源(此前逐字 4 份) */
const privacyOnError = (msg: string) => ({ success: false, data: msg })

export function registerPrivacyMaskingHandlers(): void {
  // ----- list: 列出已注册实体（密码走 EAA_PRIVACY_PASSWORD 环境变量,内存中已缓存） -----
  // 兼容旧调用：如果渲染进程仍传密码,则更新内存中的密码；否则使用已缓存的
  // 修复: 统一用 validatePassword 校验,避免弱密码静默通过(原仅检查 length>=4)
  // R37-1 修复: lock 状态下(无密码且未传新密码)不允许 list，避免泄露实体映射
  // v3.2.9 修复: 传入新密码时,仅在 CLI 真正成功后才缓存;失败则恢复原状态
  handleIpc(
    IPC.IPC_PRIVACY_LIST,
    async (_e: IpcMainInvokeEvent, password?: string) => {
      const hadPassword = eaaBridge.hasPrivacyPassword()
      if (password !== undefined && password !== null) {
        const pwd = validatePassword(password)
        eaaBridge.setPrivacyPassword(pwd)
      }
      if (!eaaBridge.hasPrivacyPassword()) return lockedResult('列出实体')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['list'],
        jsonOutput: true,
      })
      // v3.2.9: 如果传了新密码但 CLI 失败,且之前没有缓存密码,则清空避免误报 unlocked
      if (password !== undefined && password !== null) {
        const isRealSuccess =
          result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
        if (!isRealSuccess && !hadPassword) {
          eaaBridge.clearPrivacyPassword()
        }
      }
      return result
    },
    { onError: privacyOnError },
  )

  // ----- add: 添加隐私实体（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 add
  // R74-1 修复: try-catch 兜底, 把 sanitize/sanitizeEnum 抛错转结构化错误
  // (避免 IPC 层抛异常)
  handleIpc(
    IPC.IPC_PRIVACY_ADD,
    async (_e: IpcMainInvokeEvent, entityType: string, text: string) => {
      if (!eaaBridge.hasPrivacyPassword()) return lockedResult('添加实体')
      const safeType = sanitizeEnum(entityType, ENTITY_TYPES, 'entityType')
      const safeText = sanitize(text, 'text')
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['add', '--entity', safeType, '--text', safeText],
      })
      // 别名表已变 — 脱敏守卫的映射缓存作废
      if (result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))) {
        invalidatePrivacyGuardCache()
      }
      return result
    },
    { onError: privacyOnError },
  )

  // ----- dry-run: 预览脱敏效果（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 dry-run
  // R41-1 修复: try-catch 兜底，转结构化错误
  handleIpc(
    IPC.IPC_PRIVACY_DRYRUN,
    async (_e: IpcMainInvokeEvent, text: string) => {
      if (!eaaBridge.hasPrivacyPassword()) return lockedResult('预览')
      const safeText = sanitize(text, 'text')
      return await eaaBridge.execute({ command: 'privacy', args: ['dry-run', safeText] })
    },
    { onError: privacyOnError },
  )

  // ----- backup: 备份隐私库（使用内存中已缓存的密码） -----
  // R37-1 修复: lock 状态下不允许 backup，避免泄露隐私库内容
  // R75 修复: try-catch 兜底, 把 sanitize/path 校验抛错转结构化错误
  // (与 add/anonymize/filter 等处理器的错误处理风格一致)
  handleIpc(
    IPC.IPC_PRIVACY_BACKUP,
    async (_e: IpcMainInvokeEvent, destPath: string) => {
      if (!eaaBridge.hasPrivacyPassword()) return lockedResult('备份')
      const safePath = sanitize(destPath, 'destPath', 1024)
      // NUL/遍历统一守卫: 防止备份文件写入系统目录
      const pathErr = validatePathSafety(safePath, { field: 'destPath' })
      if (pathErr) return { success: false, data: pathErr }
      return await eaaBridge.execute({ command: 'privacy', args: ['backup', safePath] })
    },
    { onError: privacyOnError },
  )
}
