// =============================================================
// Ollama IPC Handlers — 本地模型管理
// ollama:detect       检测 ollama 是否可用
// ollama:start-serve  启动 ollama serve
// ollama:stop-serve   停止 ollama serve
// ollama:list-models  列出已安装模型
// ollama:pull-model   下载模型(流式进度推送到渲染进程)
// ollama:delete-model 删除模型
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { TtlLruCache } from '../services/eaa-cache'
import { ollamaService } from '../services/ollama-service'
import { log } from '../utils/logger'
import { handleIpc } from './handle'
import { sendToRenderer } from './broadcast'

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
  handleIpc(
    IPC.IPC_OLLAMA_DETECT,
    async () => {
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
    },
    (msg) => ({ available: false, serveRunning: false, error: msg }),
  )

  // 启动 serve
  // H-6 修复: 加 try-catch
  // R112: 启停后清缓存
  handleIpc(IPC.IPC_OLLAMA_START_SERVE, async () => {
    const ok = await ollamaService.startServe()
    invalidateOllamaCaches()
    return { success: ok }
  })

  // 停止 serve
  // H-6 修复: 加 try-catch
  // R112: 启停后清缓存
  handleIpc(IPC.IPC_OLLAMA_STOP_SERVE, async () => {
    ollamaService.stopServe()
    invalidateOllamaCaches()
    return { success: true }
  })

  // 列出已安装模型
  // H-6 修复: 加 try-catch
  // R112: 加 5s 缓存避免每 10s 轮询都 spawn
  handleIpc(
    IPC.IPC_OLLAMA_LIST_MODELS,
    async () => {
      const cached = ollamaListCache.get('response')
      if (cached) return cached
      const models = await ollamaService.listModels({ fresh: true })
      ollamaListCache.set('response', models)
      return models
    },
    () => [],
  )

  // 下载模型(流式进度通过 IPC 事件推送)
  // H-6 修复: 加 try-catch
  // R112: 完成后清缓存
  handleIpc(
    IPC.IPC_OLLAMA_PULL_MODEL,
    async (_e, modelName: string) => {
      log('info', 'ollama', `pull model: ${modelName}`)
      const result = await ollamaService.pullModel(modelName, (progress) => {
        // 推送进度到渲染进程
        if (!win.isDestroyed()) {
          sendToRenderer(win, IPC.IPC_OLLAMA_PULL_PROGRESS, {
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
    },
    {
      label: (modelName: string) => `ollama:pull-model failed for "${modelName}"`,
    },
  )

  // 删除模型
  // H-6 修复: 加 try-catch
  // R112: 删除后清缓存
  handleIpc(
    IPC.IPC_OLLAMA_DELETE_MODEL,
    async (_e, modelName: string) => {
      log('info', 'ollama', `delete model: ${modelName}`)
      const result = await ollamaService.deleteModel(modelName)
      if (result.success) invalidateOllamaCaches()
      return result
    },
    {
      label: (modelName: string) => `ollama:delete-model failed for "${modelName}"`,
    },
  )

  log('info', 'ollama-handlers', 'Ollama IPC handlers registered')
}
