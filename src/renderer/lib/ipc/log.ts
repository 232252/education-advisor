// =============================================================
// IPC API 类型 — T5: 日志系统域 (window.api.log)
// =============================================================

export interface LogAPI {
  list: () => Promise<Array<{ stream: string; date: string; name: string; sizeBytes: number }>>
  read: (name: string, lines?: number) => Promise<string>
  clear: () => Promise<number>
  filter: (name: string, levels: string[], lines?: number) => Promise<string>
  search: (name: string, query: string, lines?: number) => Promise<string>
  exportWithDialog: (name: string) => Promise<{ canceled: boolean; bytes: number; path?: string }>
  forward: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}
