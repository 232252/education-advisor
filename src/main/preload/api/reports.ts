// =============================================================
// Preload API — 报告中心域(R2-12)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ReportListResult, ReportReadResult } from '@shared/types/reports'
import { ipcInvoke } from '@shared/ipc-runtime'

export const reportsApi = {
  // [r] 列出全部产物
  list: () => ipcInvoke(IPC.IPC_REPORTS_LIST) as Promise<ReportListResult>,
  // [r] 读取单个产物(文件名受服务端边界校验)
  read: (fileName: string) =>
    ipcInvoke(IPC.IPC_REPORTS_READ, fileName) as Promise<ReportReadResult>,
}
