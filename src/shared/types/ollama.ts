// =============================================================
// 本地模型 (Ollama) 类型
// =============================================================

export interface OllamaModelInfo {
  name: string
  size: number
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaStatusInfo {
  /** 二进制是否可用(系统安装或打包) */
  available: boolean
  /** serve 是否在运行 */
  serveRunning: boolean
  /** 二进制路径(诊断用) */
  binaryPath?: string
}

export interface OllamaPullProgressInfo {
  /** 模型名 */
  model: string
  /** 状态: pulling / success / error */
  status: string
  /** 已下载字节 */
  completed?: number
  /** 总字节 */
  total?: number
}
