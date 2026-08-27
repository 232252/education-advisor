// =============================================================
// 报告中心 — 领域类型(R2-12)
// 产物目录: data_archive/agent_outputs/(dev:项目根 / 打包:userData)
// =============================================================

/** 报告/产物文件条目(列表用,不携带正文) */
export interface ReportEntry {
  /** 文件名(含扩展名) */
  name: string
  /** 字节大小 */
  size: number
  /** 最后修改时间(epoch ms) */
  mtimeMs: number
  /** 扩展名(.md/.json/.txt) */
  ext: string
}

export interface ReportListResult {
  success: boolean
  entries: ReportEntry[]
  error?: string
}

export interface ReportReadResult {
  success: boolean
  content?: string
  error?: string
}
