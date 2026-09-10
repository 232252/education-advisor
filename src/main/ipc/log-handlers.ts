// =============================================================
// 日志 IPC 处理器 — 真实业务实现
// =============================================================
// 委托 src/main/utils/logger.ts 中已有的函数执行实际操作。
// IPC_LOG_EXPORT_DIALOG 使用 Electron dialog.showSaveDialog()
// 获取目标路径后再调用 exportLog。
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { dialog } from 'electron'
import { errText } from '../utils/err-text'
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
import { handleIpc, registerSendHandler } from './handle'

export function registerLogHandlers(): void {
  registerSendHandler(IPC.IPC_LOG_WRITE_RENDERER, (_event, level: unknown, msg: unknown) => {
    const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const lv = validLevels.includes(level as LogLevel) ? (level as LogLevel) : 'info'
    logRenderer(lv, String(msg))
  })

  /** 注册「透传 logger 工具函数」型 handler: 调用原函数,异常统一重打 `<fn> 失败:` 标签后 rethrow */
  function registerPassThrough<A extends unknown[]>(
    channel: string,
    fnName: string,
    fn: (...args: A) => Promise<unknown>,
  ): void {
    handleIpc(channel, async (_event, ...args: A) => {
      try {
        return await fn(...args)
      } catch (err) {
        throw new Error(`${fnName} 失败: ${errText(err)}`)
      }
    })
  }

  registerPassThrough(IPC.IPC_LOG_LIST, 'listLogFiles', listLogFiles)
  registerPassThrough(IPC.IPC_LOG_READ, 'readLogTail', readLogTail)
  registerPassThrough(IPC.IPC_LOG_CLEAR, 'clearAllLogs', clearAllLogs)
  registerPassThrough(IPC.IPC_LOG_FILTER, 'readLogTailByLevel', readLogTailByLevel)
  registerPassThrough(IPC.IPC_LOG_SEARCH, 'searchLog', searchLog)

  handleIpc(IPC.IPC_LOG_EXPORT_DIALOG, async (_event, sourceName: string) => {
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
      throw new Error(`exportLogWithDialog 失败: ${errText(err)}`)
    }
  })

  console.log('[IPC] Log handlers registered (real implementation)')
}
