// =============================================================
// AI Provider handler — 列表/模型/连接测试/API Key/OAuth
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { piAIService } from '../../services/pi-ai-service'

export function registerAIProviderHandlers(): void {
  // ----- 列出所有 Provider -----
  // H-10 修复: throw err 改为返回空数组,避免渲染进程收到 raw rejection
  ipcMain.handle(IPC.IPC_AI_LIST_PROVIDERS, async () => {
    try {
      return await piAIService.listProviders()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ai:list-providers failed:', msg)
      return []
    }
  })

  // ----- 列出指定 Provider 的模型 -----
  // H-10 修复: throw err 改为返回空数组,避免渲染进程收到 raw rejection
  ipcMain.handle(IPC.IPC_AI_LIST_MODELS, async (_e, providerId: string) => {
    const stop = startIpcTimer('ai:list-models')
    try {
      return await piAIService.listModels(providerId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:list-models failed for "${providerId}":`, msg)
      return []
    } finally {
      stop()
    }
  })

  // ----- 测试连接 -----
  ipcMain.handle(
    IPC.IPC_AI_TEST_CONNECTION,
    async (_e, providerId: string, apiKey: string, baseUrl?: string) => {
      const stop = startIpcTimer('ai:test-connection')
      try {
        // H-1 修复: testConnection 内部已 try-catch 返回结构化错误,
        // 但仍要兜底外部异常(如 keystoreService.ready 抛错)
        return await piAIService.testConnection(providerId, apiKey, baseUrl)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] ai:test-connection threw for "${providerId}":`, msg)
        return {
          success: false,
          latencyMs: 0,
          model: '',
          error: msg,
        }
      } finally {
        stop()
      }
    },
  )

  // ----- 设置 API Key -----
  ipcMain.handle(IPC.IPC_AI_SET_API_KEY, async (_e, providerId: string, apiKey: string) => {
    // H-2 修复: keystoreService 可能抛错(如 keychain 不可用),必须 try-catch
    try {
      piAIService.setApiKey(providerId, apiKey)
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:set-api-key failed for "${providerId}":`, msg)
      return { success: false, error: msg }
    }
  })

  // ----- 删除 API Key -----
  ipcMain.handle(IPC.IPC_AI_DELETE_API_KEY, async (_e, providerId: string) => {
    try {
      piAIService.deleteApiKey(providerId)
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:delete-api-key failed for "${providerId}":`, msg)
      return { success: false, error: msg }
    }
  })

  // ----- OAuth 登录(P0 修复)-----
  // H-10 修复: 加 try-catch,OAuth 流程失败返回结构化错误
  ipcMain.handle(IPC.IPC_AI_OAUTH_LOGIN, async (_e, providerId: string) => {
    try {
      return await piAIService.oauthLogin(providerId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:oauth-login failed for "${providerId}":`, msg)
      return { success: false, error: msg }
    }
  })
}
