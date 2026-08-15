// =============================================================
// Preload API — AI / LLM 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { StreamEvent } from '@shared/types'
import { ipcRenderer } from 'electron'

export const aiApi = {
  // [r] 列出所有已配置 Provider
  listProviders: () => ipcRenderer.invoke(IPC.IPC_AI_LIST_PROVIDERS),

  // [r] 列出某 Provider 的可用模型
  listModels: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_LIST_MODELS, providerId),

  // [r] 测试 Provider 连通性(apiKey 不持久化)
  testConnection: (providerId: string, apiKey: string, baseUrl?: string) =>
    ipcRenderer.invoke(IPC.IPC_AI_TEST_CONNECTION, providerId, apiKey, baseUrl),

  // [w] 设置 API Key(走 keystore-service 加密存储)
  setApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke(IPC.IPC_AI_SET_API_KEY, providerId, apiKey),

  // [c] 删除 API Key — UI 层应二次确认
  deleteApiKey: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_DELETE_API_KEY, providerId),

  // [w] OAuth 登录(P0-4 handler)
  oauthLogin: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_OAUTH_LOGIN, providerId),

  // [w] 发起对话(走 LLM 流式)
  chat: (params: {
    providerId: string
    modelId: string
    messages: Array<{ role: string; content: string }>
    systemPrompt?: string
    thinking?: string
    maxTokens?: number
  }) => ipcRenderer.invoke(IPC.IPC_AI_CHAT, params),

  // [w] 添加自定义模型
  addCustomModel: (params: {
    providerId: string
    modelId: string
    name?: string
    contextWindow?: number
    maxOutputTokens?: number
    supportsReasoning?: boolean
  }) => ipcRenderer.invoke(IPC.IPC_AI_ADD_CUSTOM_MODEL, params),

  // [c] 删除自定义模型
  deleteCustomModel: (providerId: string, modelId: string) =>
    ipcRenderer.invoke(IPC.IPC_AI_DEL_CUSTOM_MODEL, providerId, modelId),

  // [w] 更新自定义模型属性
  updateCustomModel: (params: {
    providerId: string
    modelId: string
    name?: string
    contextWindow?: number
    maxOutputTokens?: number
    supportsReasoning?: boolean
    costPerInputToken?: number
    costPerOutputToken?: number
    api?: string
    baseUrl?: string
  }) => ipcRenderer.invoke(IPC.IPC_AI_UPDATE_CUSTOM_MODEL, params),

  /** 订阅 LLM 流式事件，返回取消订阅函数 */
  onStream: (callback: (event: StreamEvent) => void) => {
    const handler = (_e: unknown, data: StreamEvent) => callback(data)
    ipcRenderer.on(IPC.IPC_AI_CHAT_STREAM, handler)
    return () => {
      ipcRenderer.removeListener(IPC.IPC_AI_CHAT_STREAM, handler)
    }
  },
}
