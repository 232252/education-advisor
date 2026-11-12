// =============================================================
// Preload API — 教师点击确认
// =============================================================

import type { TeacherConfirmAPI } from '@shared/api/teacher-confirm'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const teacherConfirmApi: TeacherConfirmAPI = {
  respond: (id, accepted) => ipcInvoke(IPC.IPC_TEACHER_CONFIRM_RESPOND, id, accepted),
  onRequest: (callback) => subscribe(IPC.IPC_TEACHER_CONFIRM_REQUEST, callback),
}
