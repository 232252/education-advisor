// =============================================================
// IPC API 类型 — 本地模型 Ollama 域 (window.api.ollama)
// =============================================================

import type { OllamaModelInfo, OllamaPullProgressInfo, OllamaStatusInfo } from '@shared/types'

export interface OllamaAPI {
  detect: () => Promise<OllamaStatusInfo>
  startServe: () => Promise<{ success: boolean }>
  stopServe: () => Promise<{ success: boolean }>
  listModels: () => Promise<OllamaModelInfo[]>
  pullModel: (modelName: string) => Promise<{ success: boolean; error?: string }>
  deleteModel: (modelName: string) => Promise<{ success: boolean; error?: string }>
  onPullProgress: (callback: (info: OllamaPullProgressInfo) => void) => () => void
}
