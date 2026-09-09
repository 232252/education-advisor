// =============================================================
// 报告中心 IPC(R2-12) — list/read 两个通道
// 产物目录安全由 reports-service 边界校验保证
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ReportListResult, ReportReadResult } from '@shared/types/reports'
import { listReports, readReport } from '../services/reports-service'
import { handleIpc } from './handle'

export function registerReportsHandlers(): void {
  handleIpc(
    IPC.IPC_REPORTS_LIST,
    (): ReportListResult => {
      return listReports()
    },
    (msg) => ({ success: false, entries: [], error: msg }),
  )

  handleIpc(IPC.IPC_REPORTS_READ, (_e, fileName: string): ReportReadResult => {
    return readReport(typeof fileName === 'string' ? fileName : '')
  })
}
