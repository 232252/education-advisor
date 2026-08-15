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
 */
export interface RecommendedModel {
  tag: string
  name: string
  sizeLabel: string
  chineseLevel: '优秀' | '良好' | '一般'
  tier: 'CPU入门' | 'CPU进阶' | 'GPU/大内存'
  description: string
  /** 手动下载 GGUF 的备选链接(免登录) */
  manualUrls: Array<{ label: string; url: string }>
}
