// =============================================================
// IPC API 类型 — 报告中心域 (window.api.reports)
// =============================================================

import type { ReportListResult, ReportReadResult } from '@shared/types/reports'

export interface ReportsAPI {
  /** 列出全部产物(按修改时间倒序) */
  list: () => Promise<ReportListResult>
  /** 读取单个产物(服务端边界校验文件名) */
  read: (fileName: string) => Promise<ReportReadResult>
}

export type { ReportEntry, ReportListResult, ReportReadResult } from '@shared/types/reports'
