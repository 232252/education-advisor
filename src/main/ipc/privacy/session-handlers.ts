// =============================================================
// 隐私引擎会话 handler — init/load/lock/status(密码生命周期)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { invalidatePrivacyGuardCache } from '../../services/agent/privacy-guard'
import { eaaBridge } from '../../services/eaa-bridge'
import { handleIpc } from '../handle'
import { validatePassword } from './params'

export function registerPrivacySessionHandlers(): void {
  // ----- init: 初始化隐私引擎（Rust CLI 要求 password 作为位置参数） -----
  // 渲染进程发送一次密码后,主进程在内存中保留,渲染进程应立即清空自身状态
  // v3.2.9 修复: 仅在 CLI 真正成功时才缓存密码,避免初始化失败后 status 误报 unlocked=true
  // 注意: EAA CLI 对 privacy load/init 失败时仍返回 exitCode=0 + success=true,
  //       错误信息在 data 字段中以 "❌" 开头,所以需要额外检查 data 内容
  // R81 修复: 包裹 try-catch, 把 validatePassword 抛错转结构化错误 (与 unlock/add 等处理器一致)
  // 失败信封为 data 形状(前端 getErrorMessage 优先读 data),onError 定制保持契约
  handleIpc(
    IPC.IPC_PRIVACY_INIT,
    async (_e: IpcMainInvokeEvent, password: string, autoScan?: boolean) => {
      const pwd = validatePassword(password)
      const args: string[] = [pwd]
      if (autoScan) args.push('--auto-scan')
      const result = await eaaBridge.execute({ command: 'privacy', args: ['init', ...args] })
      // 仅当 CLI 成功且 data 不包含错误标记时才缓存密码
      const isRealSuccess =
        result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
      if (isRealSuccess) {
        eaaBridge.setPrivacyPassword(pwd)
        invalidatePrivacyGuardCache() // 映射可能已变,守卫缓存作废
      }
      return result
    },
    { onError: (msg) => ({ success: false, data: msg }) },
  )

  // ----- load: 加载已存在的隐私库（Rust CLI 要求 password 作为位置参数） -----
  // v3.2.9 修复: 仅在 CLI 真正成功时才缓存密码,避免密码错误时 status 误报 unlocked=true
  // R81 修复: 包裹 try-catch, 把 validatePassword 抛错转结构化错误
  handleIpc(
    IPC.IPC_PRIVACY_LOAD,
    async (_e: IpcMainInvokeEvent, password: string) => {
      const pwd = validatePassword(password)
      const result = await eaaBridge.execute({ command: 'privacy', args: ['load', pwd] })
      // 仅当 CLI 成功且 data 不包含错误标记时才缓存密码
      const isRealSuccess =
        result.success && !(typeof result.data === 'string' && result.data.startsWith('❌'))
      if (isRealSuccess) {
        eaaBridge.setPrivacyPassword(pwd)
        invalidatePrivacyGuardCache() // 映射可能已变,守卫缓存作废
      }
      return result
    },
    { onError: (msg) => ({ success: false, data: msg }) },
  )

  // ----- lock: 锁定隐私引擎（清空内存中的密码,后续命令将无法使用隐私功能） -----
  // 渲染进程调用此方法后,需要重新输入密码才能继续使用隐私功能
  handleIpc(IPC.IPC_PRIVACY_LOCK, async () => {
    eaaBridge.clearPrivacyPassword()
    invalidatePrivacyGuardCache() // fail-closed 语义: 锁定后缓存必须作废
    return { success: true }
  })

  // ----- status: 查询隐私引擎状态（是否已加载密码,是否已初始化） -----
  // 不返回密码本身,只返回布尔状态
  ipcMain.handle(IPC.IPC_PRIVACY_STATUS, async () => {
    return {
      unlocked: eaaBridge.hasPrivacyPassword(),
    }
  })
}
