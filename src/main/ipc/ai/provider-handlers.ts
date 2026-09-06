// =============================================================
// AI Provider handler — 列表/模型/连接测试/API Key/OAuth
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { piAIService } from '../../services/pi-ai-service'
import { handleIpc } from '../handle'

export function registerAIProviderHandlers(): void {
  // ----- 列出所有 Provider -----
  // H-10 修复: throw err 改为返回空数组,避免渲染进程收到 raw rejection
  handleIpc(
    IPC.IPC_AI_LIST_PROVIDERS,
    async () => {
      return await piAIService.listProviders()
    },
    () => [],
  )

  // ----- 列出指定 Provider 的模型 -----
  // H-10 修复: throw err 改为返回空数组,避免渲染进程收到 raw rejection
  handleIpc(
    IPC.IPC_AI_LIST_MODELS,
    (_e, providerId: string) => piAIService.listModels(providerId),
    {
      timer: 'ai:list-models',
      onError: () => [],
      label: (providerId: string) => `ai:list-models failed for "${providerId}"`,
    },
  )

  // ----- 测试连接 -----
  handleIpc(
    IPC.IPC_AI_TEST_CONNECTION,
    async (_e, providerId: string, apiKey: string, baseUrl?: string) => {
      // H-1 修复: testConnection 内部已 try-catch 返回结构化错误,
      // 但仍要兜底外部异常(如 keystoreService.ready 抛错)
      return await piAIService.testConnection(providerId, apiKey, baseUrl)
    },
    {
      timer: 'ai:test-connection',
      onError: (msg) => ({ success: false, latencyMs: 0, model: '', error: msg }),
      label: (providerId: string) => `ai:test-connection threw for "${providerId}"`,
    },
  )

  // ----- 设置 API Key -----
  handleIpc(
    IPC.IPC_AI_SET_API_KEY,
    async (_e, providerId: string, apiKey: string) => {
      // H-2 修复: keystoreService 可能抛错(如 keychain 不可用),必须 try-catch
      piAIService.setApiKey(providerId, apiKey)
      return { success: true }
    },
    {
      label: (providerId: string) => `ai:set-api-key failed for "${providerId}"`,
    },
  )

  // ----- 删除 API Key -----
  handleIpc(
    IPC.IPC_AI_DELETE_API_KEY,
    async (_e, providerId: string) => {
      piAIService.deleteApiKey(providerId)
      return { success: true }
    },
    {
      label: (providerId: string) => `ai:delete-api-key failed for "${providerId}"`,
    },
  )

  // ----- OAuth 登录(P0 修复)-----
  // H-10 修复: 加 try-catch,OAuth 流程失败返回结构化错误
  handleIpc(
    IPC.IPC_AI_OAUTH_LOGIN,
    async (_e, providerId: string) => {
      return await piAIService.oauthLogin(providerId)
    },
    {
      label: (providerId: string) => `ai:oauth-login failed for "${providerId}"`,
    },
  )
}
