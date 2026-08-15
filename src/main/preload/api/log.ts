// =============================================================
// Preload API — 日志系统域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const logApi = {
  // [r] 列日志文件
  list: () => ipcRenderer.invoke(IPC.IPC_LOG_LIST),
  // [r] 读 tail N 行
  read: (name: string, lines?: number) => ipcRenderer.invoke(IPC.IPC_LOG_READ, name, lines),
  // [c] 清空所有日志 — UI 层应二次确认
  clear: () => ipcRenderer.invoke(IPC.IPC_LOG_CLEAR),
  // [r] T3: level 过滤读 tail
  filter: (name: string, levels: string[], lines?: number) =>
    ipcRenderer.invoke(IPC.IPC_LOG_FILTER, name, levels, lines),
  // [r] T3: 文本搜索
  search: (name: string, query: string, lines?: number) =>
    ipcRenderer.invoke(IPC.IPC_LOG_SEARCH, name, query, lines),
  // [w] T3: 导出 + 原生保存对话框
  exportWithDialog: (name: string) => ipcRenderer.invoke(IPC.IPC_LOG_EXPORT_DIALOG, name),
  // [w] 渲染端 console 转发到主进程 logs/renderer-*.log
  forward: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) =>
    ipcRenderer.send(IPC.IPC_LOG_WRITE_RENDERER, level, msg),
}
