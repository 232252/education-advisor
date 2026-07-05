// =============================================================
// Ollama IPC Handlers — 本地模型管理
// ollama:detect       检测 ollama 是否可用
// ollama:start-serve  启动 ollama serve
// ollama:stop-serve   停止 ollama serve
// ollama:list-models  列出已安装模型
// ollama:pull-model   下载模型(流式进度推送到渲染进程)
// ollama:delete-model 删除模型
// =============================================================

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { ollamaService } from '../services/ollama-service'
import { log } from '../utils/logger'

export function registerOllamaHandlers(win: BrowserWindow): void {
  // 检测 ollama 是否可用
  ipcMain.handle(IPC.IPC_OLLAMA_DETECT, async () => {
    const available = await ollamaService.detect()
    const serveRunning = await ollamaService.isServeRunning()
    return {
      available,
      serveRunning,
      binaryPath: ollamaService.resolveBinaryPath() ?? undefined,
    }
  })

  // 启动 serve
  ipcMain.handle(IPC.IPC_OLLAMA_START_SERVE, async () => {
    const ok = await ollamaService.startServe()
    return { success: ok }
  })

  // 停止 serve
  ipcMain.handle(IPC.IPC_OLLAMA_STOP_SERVE, async () => {
    ollamaService.stopServe()
    return { success: true }
  })

  // 列出已安装模型
  ipcMain.handle(IPC.IPC_OLLAMA_LIST_MODELS, async () => {
    return await ollamaService.listModels()
  })

  // 下载模型(流式进度通过 IPC 事件推送)
  ipcMain.handle(IPC.IPC_OLLAMA_PULL_MODEL, async (_e, modelName: string) => {
    log('info', 'ollama', `pull model: ${modelName}`)
    const result = await ollamaService.pullModel(modelName, (progress) => {
      // 推送进度到渲染进程
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.IPC_OLLAMA_PULL_PROGRESS, {
          model: modelName,
          status: progress.status,
          completed: progress.completed,
          total: progress.total,
        })
      }
    })
    log('info', 'ollama', `pull ${modelName} done: success=${result.success}`)
    return result
  })

  // 删除模型
  ipcMain.handle(IPC.IPC_OLLAMA_DELETE_MODEL, async (_e, modelName: string) => {
    log('info', 'ollama', `delete model: ${modelName}`)
    return await ollamaService.deleteModel(modelName)
  })

  log('info', 'ollama-handlers', 'Ollama IPC handlers registered')
}
