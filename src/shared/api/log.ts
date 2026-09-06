// =============================================================
// 日志系统 API 类型(单一来源: preload 实现按此注解)
// =============================================================

/** 日志文件条目(按 stream/date 分割命名) */
export interface LogFileInfo {
  stream: string
  date: string
  name: string
  sizeBytes: number
}

/** 导出结果(原生保存对话框) */
export interface LogExportResult {
  canceled: boolean
  bytes: number
  path: string
}

export interface LogAPI {
  list: () => Promise<LogFileInfo[]>
  /** 读 tail N 行 */
  read: (name: string, lines?: number) => Promise<string>
  /** 清空所有日志 — UI 层应二次确认 */
  clear: () => Promise<void>
  /** level 过滤读 tail */
  filter: (name: string, levels: string[], lines?: number) => Promise<string>
  /** 文本搜索 */
  search: (name: string, query: string, lines?: number) => Promise<string>
  /** 导出 + 原生保存对话框 */
  exportWithDialog: (name: string) => Promise<LogExportResult>
  /** 渲染端 console 转发到主进程 logs/renderer-*.log */
  forward: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}
