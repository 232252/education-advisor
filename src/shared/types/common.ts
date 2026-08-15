// =============================================================
// 通用类型 — IPC 请求/响应等跨域公共结构
// =============================================================

export interface TestConnectionResult {
  success: boolean
  latencyMs: number
  model: string
  error?: string
}

export interface ConnectionTestParams {
  providerId: string
  apiKey: string
  baseUrl?: string
}
