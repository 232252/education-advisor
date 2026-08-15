// =============================================================
// plugins-overview — 插件中心概览数据类型与纯状态推导
// 逻辑自 tabs/PluginsTab.tsx 逐字搬移
// =============================================================

/** MCP 概览数据 */
export interface McpOverview {
  enabled: boolean
  total: number
  active: number
}

/** Cron 概览数据 */
export interface CronOverview {
  total: number
  enabled: number
}

/** 飞书机器人状态（简化） */
export interface FeishuOverview {
  status: string | null
}

/** 本地模型概览 */
export interface OllamaOverview {
  modelCount: number
  running: boolean
}

// 判定是否"全部空"——MCP 禁用 + 技能 0 + cron 0 + 飞书未连 + ollama 未跑
export function isPluginsAllEmpty(
  mcp: McpOverview | null,
  skillsCount: number,
  cron: CronOverview | null,
  feishu: FeishuOverview | null,
  ollama: OllamaOverview | null,
): boolean {
  return (
    (mcp === null || (!mcp.enabled && mcp.total === 0)) &&
    skillsCount === 0 &&
    (cron === null || cron.total === 0) &&
    (feishu === null || feishu.status === null || feishu.status === 'idle') &&
    (ollama === null || (!ollama.running && ollama.modelCount === 0))
  )
}
