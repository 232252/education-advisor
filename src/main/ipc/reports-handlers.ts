// =============================================================
// 报告中心 IPC(R2-12) — list/read 两个通道
// 产物目录安全由 reports-service 边界校验保证
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { ReportListResult, ReportReadResult } from '@shared/types/reports'
import { ipcMain } from 'electron'
import { listReports, readReport } from '../services/reports-service'

export function registerReportsHandlers(): void {
  ipcMain.handle(IPC.IPC_REPORTS_LIST, (): ReportListResult => {
    try {
      return listReports()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] reports:list failed:', msg)
      return { success: false, entries: [], error: msg }
    }
  })

  ipcMain.handle(IPC.IPC_REPORTS_READ, (_e, fileName: string): ReportReadResult => {
    try {
      return readReport(typeof fileName === 'string' ? fileName : '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] reports:read failed:', msg)
      return { success: false, error: msg }
    }
  })
}
