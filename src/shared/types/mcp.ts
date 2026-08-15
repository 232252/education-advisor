// =============================================================
// MCP (Model Context Protocol) 相关类型
// =============================================================

export type McpTransport = 'stdio' | 'sse' | 'websocket'

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  enabled: boolean
  transport: McpTransport
  /** stdio 传输:要执行的命令 */
  command?: string
  /** stdio 传输:命令参数 */
  args?: string[]
  /** stdio 传输:环境变量 */
  env?: Record<string, string>
  /** sse/websocket 传输:服务器 URL */
  url?: string
  /** sse/websocket 传输:HTTP 请求头 */
  headers?: Record<string, string>
  /** 覆盖来源标记:用户级覆盖了某个全局同 id server 时标记,remove 时据此恢复全局默认 */
  overrides?: 'global'
  /** 配置来源(运行时注入,不持久化):global 只读 / user 可改 */
  source?: 'global' | 'user'
}

export interface McpTool {
  serverId: string
  name: string
  description: string
  /** JSON Schema 格式的参数定义 */
  inputSchema: object
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
  lastError?: string
  transport: McpTransport
  /** 配置来源:全局只读 / 用户级可改 */
  source: 'global' | 'user'
  /** 是否启用(透传给前端显示开关) */
  enabled: boolean
}
