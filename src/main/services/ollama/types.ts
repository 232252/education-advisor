// =============================================================
// Ollama 类型定义 — 模型 / pull 进度 / 推荐模型
// =============================================================

export interface OllamaModel {
  name: string
  size: number
  digest: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaPullProgress {
  status: string
  completed?: number
  total?: number
  digest?: string
}

/**
 * 推荐的本地模型列表(中文友好 + CPU友好)。
 * 用户可在模型页一键下载。
 * 类型单一来源在 @shared/recommended-models,此处转发。
 */
export type { RecommendedModel } from '@shared/recommended-models'
