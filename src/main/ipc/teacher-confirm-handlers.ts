// =============================================================
// 教师点击确认 — 主进程把等待中的工具调用接到当前窗口
// =============================================================

import type { TeacherConfirmRequest } from '@shared/api/teacher-confirm'
import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { resolveTeacherConfirm, setTeacherConfirmSender } from '../services/teacher-confirm'
import { sendToRenderer } from './broadcast'
import { handleIpc } from './handle'

export function registerTeacherConfirmHandlers(win: BrowserWindow): void {
  setTeacherConfirmSender((req: TeacherConfirmRequest) => {
    if (!win || win.isDestroyed()) {
      throw new Error('教师确认窗口不可用，操作已取消')
    }
    sendToRenderer(win, IPC.IPC_TEACHER_CONFIRM_REQUEST, req)
  })

  handleIpc(IPC.IPC_TEACHER_CONFIRM_RESPOND, async (_e, id: unknown, accepted: unknown) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('missing confirm id')
    }
    const ok = resolveTeacherConfirm(id, accepted === true)
    return { success: true, data: ok }
  })
}
