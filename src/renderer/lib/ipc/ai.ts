// =============================================================
// IPC API 类型 — AI / LLM 域 (window.api.ai)
// 方法名与 preload 脚本一一对应,不可改动
// =============================================================

import type { ModelInfo, ProviderInfo, StreamEvent, TestConnectionResult } from '@shared/types'

export interface AiAPI {
  listProviders: () => Promise<ProviderInfo[]>
  listModels: (providerId: string) => Promise<ModelInfo[]>
  testConnection: (
    providerId: string,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<TestConnectionResult>
  setApiKey: (providerId: string, apiKey: string) => Promise<{ success: boolean }>
  deleteApiKey: (providerId: string) => Promise<{ success: boolean }>
  oauthLogin: (
    providerId: string,
  ) => Promise<{ success: boolean; error?: string; authUrl?: string }>
  chat: (params: {
    providerId: string
    modelId: string
    messages: Array<{ role: string; content: string }>
    systemPrompt?: string
    thinking?: string
    maxTokens?: number
  }) => Promise<{ success: boolean; message: string; sessionId?: string }>
  addCustomModel: (params: {
    providerId: string
    modelId: string
    name?: string
    contextWindow?: number
    maxOutputTokens?: number
    supportsReasoning?: boolean
  }) => Promise<ModelInfo>
  deleteCustomModel: (providerId: string, modelId: string) => Promise<{ success: boolean }>
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
  }) => Promise<{ success: boolean }>
  onStream: (callback: (event: StreamEvent) => void) => () => void
}
