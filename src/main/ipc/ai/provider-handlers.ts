// =============================================================
// AI Provider handler — 列表/模型/连接测试/API Key/OAuth
// 对话选择器与模型页的目录和当前路由以 DSH 为源；密钥仍走 keystore。
// =============================================================

import * as IPC from '@shared/ipc-channels'
import {
  getDshCurrentRoute,
  listDshModels,
  listDshProviders,
  selectDshRoute,
  syncDshProviderCredential,
} from '../../services/dsh/dsh-model-settings'
import { piAIService } from '../../services/pi-ai-service'
import { handleIpc } from '../handle'

export function registerAIProviderHandlers(): void {
  // ----- 列出 DSH 目录中的 Provider（含 profile 额外路由） -----
  handleIpc(
    IPC.IPC_AI_LIST_PROVIDERS,
    async () => {
      return await listDshProviders()
    },
    () => [],
  )

  // ----- 列出指定 Provider 在 DSH 目录 / profile 中的模型 -----
  handleIpc(
    IPC.IPC_AI_LIST_MODELS,
    (_e, providerId: string) => listDshModels(providerId),
    {
      timer: 'ai:list-models',
      onError: () => [],
      label: (providerId: string) => `ai:list-models failed for "${providerId}"`,
    },
  )

  handleIpc(
    IPC.IPC_AI_GET_DSH_ROUTE,
    async () => getDshCurrentRoute(),
    () => null,
  )

  handleIpc(
    IPC.IPC_AI_SELECT_DSH_ROUTE,
    async (_e, selection: { provider: string; model: string; reasoningEffort?: string }) => {
      return selectDshRoute(selection)
    },
    {
      label: () => 'ai:select-dsh-route failed',
    },
  )

  // ----- 测试连接 -----
  handleIpc(
    IPC.IPC_AI_TEST_CONNECTION,
    async (_e, providerId: string, apiKey: string, baseUrl?: string) => {
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
      piAIService.setApiKey(providerId, apiKey)
      syncDshProviderCredential(providerId)
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
