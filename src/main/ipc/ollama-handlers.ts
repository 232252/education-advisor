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
import { TtlLruCache } from '../services/eaa-cache'

/**
 * PERF: ollama:detect 和 ollama:list-models 缓存
 * LocalModelsSection.tsx 每 10s 轮询这两个通道,每次都 spawn `ollama --version` / `ollama list`。
 * 加 5s TTL 缓存减少 50% spawn, 同时保证用户手动安装/删除模型后 5s 内能看到更新。
 * pull/delete/start-serve/stop-serve 后立即清空缓存,保证操作即时生效。
 */
const ollamaDetectCache = new TtlLruCache<{
  available: boolean
  serveRunning: boolean
  binaryPath?: string
}>({ ttlMs: 5_000, maxEntries: 2 })
const ollamaListCache = new TtlLruCache<unknown[]>({ ttlMs: 5_000, maxEntries: 2 })

/** 失效所有 ollama 缓存 (pull/delete/start/stop 后调用) */
function invalidateOllamaCaches() {
  ollamaDetectCache.clear()
  ollamaListCache.clear()
}

export function registerOllamaHandlers(win: BrowserWindow): void {
  // 检测 ollama 是否可用
  // H-6 修复: 加 try-catch
  // R112: 加 5s 缓存避免每 10s 轮询都 spawn
  ipcMain.handle(IPC.IPC_OLLAMA_DETECT, async () => {
    try {
      const cached = ollamaDetectCache.get('response')
      if (cached) return cached
      const available = await ollamaService.detect()
      const serveRunning = await ollamaService.isServeRunning()
      const result = {
        available,
        serveRunning,
        binaryPath: ollamaService.resolveBinaryPath() ?? undefined,
      }
      ollamaDetectCache.set('response', result)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ollama:detect failed:', msg)
      return { available: false, serveRunning: false, error: msg }
    }
  })

  // 启动 serve
  // H-6 修复: 加 try-catch
  // R112: 启停后清缓存
  ipcMain.handle(IPC.IPC_OLLAMA_START_SERVE, async () => {
    try {
      const ok = await ollamaService.startServe()
      invalidateOllamaCaches()
      return { success: ok }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ollama:start-serve failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 停止 serve
  // H-6 修复: 加 try-catch
  // R112: 启停后清缓存
  ipcMain.handle(IPC.IPC_OLLAMA_STOP_SERVE, async () => {
    try {
      ollamaService.stopServe()
      invalidateOllamaCaches()
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ollama:stop-serve failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 列出已安装模型
  // H-6 修复: 加 try-catch
  // R112: 加 5s 缓存避免每 10s 轮询都 spawn
  ipcMain.handle(IPC.IPC_OLLAMA_LIST_MODELS, async () => {
    try {
      const cached = ollamaListCache.get('response')
      if (cached) return cached
      const models = await ollamaService.listModels()
      ollamaListCache.set('response', models)
      return models
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ollama:list-models failed:', msg)
      return []
    }
  })

  // 下载模型(流式进度通过 IPC 事件推送)
  // H-6 修复: 加 try-catch
  // R112: 完成后清缓存
  ipcMain.handle(IPC.IPC_OLLAMA_PULL_MODEL, async (_e, modelName: string) => {
    try {
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
      // 模型列表变了, 失效缓存
      if (result.success) invalidateOllamaCaches()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ollama:pull-model failed for "${modelName}":`, msg)
      return { success: false, error: msg }
    }
  })

  // 取消正在进行的下载
  // M-1 修复: 支持 abort pullModel 流式操作
  ipcMain.handle(IPC.IPC_OLLAMA_CANCEL_PULL, async () => {
    try {
      ollamaService.cancelPull()
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ollama:cancel-pull failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 删除模型
  // H-6 修复: 加 try-catch
  // R112: 删除后清缓存
  ipcMain.handle(IPC.IPC_OLLAMA_DELETE_MODEL, async (_e, modelName: string) => {
    try {
      log('info', 'ollama', `delete model: ${modelName}`)
      const result = await ollamaService.deleteModel(modelName)
      if (result.success) invalidateOllamaCaches()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ollama:delete-model failed for "${modelName}":`, msg)
      return { success: false, error: msg }
    }
  })

  log('info', 'ollama-handlers', 'Ollama IPC handlers registered')
}
