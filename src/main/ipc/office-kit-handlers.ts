// =============================================================
// office-kit IPC — 插件中心的组件状态/安装入口
//
// 只读转发 office-kit-service：状态与安装都是幂等查询/触发，
// 进度靠 status 轮询（installing.message）。
// =============================================================

import type { OfficeKitStatus } from '@shared/api/office-kit'
import * as IPC from '@shared/ipc-channels'
import { ensureOfficeKit, officeKitStatus } from '../services/dsh/office-kit-service'
import { handleIpc } from './handle'

export function registerOfficeKitHandlers(): void {
  handleIpc(IPC.IPC_OFFICE_KIT_STATUS, async (): Promise<OfficeKitStatus> => officeKitStatus())

  handleIpc(IPC.IPC_OFFICE_KIT_INSTALL, async (): Promise<OfficeKitStatus> => {
    const result = await ensureOfficeKit()
    const status = officeKitStatus()
    if (!result.ok && status.state !== 'ready') {
      return { state: 'unknown', message: result.error ?? 'office 组件安装失败' }
    }
    return status
  })
}
