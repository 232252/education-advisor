// =============================================================
// IPC API 类型 — T7: 飞书集成域 (window.api.feishu)
// appSecret 从 keystore 读取，不再通过参数传递
// =============================================================

export interface FeishuAPI {
  test: (
    appId: string,
  ) => Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }>
  listBitable: (
    appId: string,
    appToken: string,
  ) => Promise<{
    success: boolean
    tables?: Array<{ table_id: string; name: string }>
    error?: string
  }>
  // [r] 查 token 缓存状态(诊断用,不返回 token 本体)
  status: () => Promise<string>
  diagnose: () => Promise<{
    steps: Array<{
      name: string
      status: 'pass' | 'fail' | 'skip'
      latencyMs?: number
      detail: string
      suggestion?: string
    }>
    overall: 'pass' | 'fail'
    domain: string
    timestamp: number
    error?: string
  }>
}
