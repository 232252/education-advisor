// =============================================================
// 日志 IPC 处理器 — 真实业务实现
// =============================================================
// 委托 src/main/utils/logger.ts 中已有的函数执行实际操作。
// IPC_LOG_EXPORT_DIALOG 使用 Electron dialog.showSaveDialog()
// 获取目标路径后再调用 exportLog。
// =============================================================

import { dialog, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { LogLevel } from '../utils/logger'
import {
  clearAllLogs,
  exportLog,
  listLogFiles,
  logRenderer,
  readLogTail,
  readLogTailByLevel,
  searchLog,
} from '../utils/logger'

export function registerLogHandlers(): void {
  // 渲染进程 console 转发 (单向通知, 不需要 handle)
  // C-1 修复: 原本只有 preload.send 但主进程无监听者,导致 renderer-*.log 永远不生成
  ipcMain.on(IPC.IPC_LOG_WRITE_RENDERER, (_event, level: string, msg: string) => {
    const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const lv = validLevels.includes(level as LogLevel) ? (level as LogLevel) : 'info'
    logRenderer(lv, String(msg))
  })

  ipcMain.handle(IPC.IPC_LOG_LIST, async () => {
    try {
      return await listLogFiles()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`listLogFiles 失败: ${msg}`)
    }
  })

  ipcMain.handle(IPC.IPC_LOG_READ, async (_event, filePath: string, lines?: number) => {
    try {
      return await readLogTail(filePath, lines)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`readLogTail 失败: ${msg}`)
    }
  })

  ipcMain.handle(IPC.IPC_LOG_CLEAR, async () => {
    try {
      return await clearAllLogs()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`clearAllLogs 失败: ${msg}`)
    }
  })

  ipcMain.handle(
    IPC.IPC_LOG_FILTER,
    async (_event, filePath: string, levels: string[], lines?: number) => {
      try {
        return await readLogTailByLevel(filePath, levels, lines)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`readLogTailByLevel 失败: ${msg}`)
      }
    },
  )

  ipcMain.handle(
    IPC.IPC_LOG_SEARCH,
    async (_event, filePath: string, query: string, maxResults?: number) => {
      try {
        return await searchLog(filePath, query, maxResults)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`searchLog 失败: ${msg}`)
      }
    },
  )

  ipcMain.handle(IPC.IPC_LOG_EXPORT, async (_event, sourcePath: string, destPath: string) => {
    try {
      return await exportLog(sourcePath, destPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`exportLog 失败: ${msg}`)
    }
  })

  ipcMain.handle(IPC.IPC_LOG_EXPORT_DIALOG, async (_event, sourceName: string) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '导出日志文件',
        defaultPath: sourceName,
        filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, bytes: 0, path: undefined }
      }
      const bytes = await exportLog(sourceName, result.filePath)
      return { canceled: false, bytes, path: result.filePath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`exportLogWithDialog 失败: ${msg}`)
    }
  })

  console.log('[IPC] Log handlers registered (real implementation)')
}
