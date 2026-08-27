// =============================================================
// Agent 配置解析 — agents.yaml 原始条目 → AgentConfig 纯映射
// 从 agent-service.ts loadAgents 下沉(纯重构,行为零变化):
//   - buildAgentConfig: 单条 yaml 条目叠加 user override 生成 AgentConfig
// =============================================================

import type { AgentConfig } from '@shared/types'

/** user override 结构(与 agent-scheduler.ts Override 结构一致,结构化类型兼容) */
export interface AgentOverride {
  enabled?: boolean
  name?: string
  description?: string
  modelTier?: 'high_quality' | 'low_cost'
  capabilities?: string[]
  mcpServers?: string[]
}

/** agents.yaml 中单个 agent 原始条目(yaml.parse 产物,宽松类型) */
export interface RawAgentEntry {
  id?: unknown
  name?: unknown
  role?: unknown
  description?: unknown
  enabled?: unknown
  model_tier?: unknown
  /**
   * schedule.cron 条目支持两种形态(向后兼容):
   *   - 字符串: "0 6 * * *"(仅表达式,任务提示词回退泛化句)
   *   - 对象:   { cron: "0 6 * * *", prompt: "执行晨间数据质量检查: ..." }
   */
  schedule?: { cron?: unknown }
  capabilities?: unknown
  risk_thresholds?: unknown
  mcp_servers?: unknown
}

/** 解析 schedule.cron 条目 → 表达式数组 + 平行的 prompt 数组(无 prompt 处为 undefined) */
export function parseScheduleEntries(raw: unknown): {
  expressions: string[]
  prompts: Array<string | undefined>
} {
  const expressions: string[] = []
  const prompts: Array<string | undefined> = []
  if (!Array.isArray(raw)) return { expressions, prompts }
  for (const entry of raw) {
    if (typeof entry === 'string') {
      expressions.push(entry)
      prompts.push(undefined)
    } else if (entry && typeof entry === 'object' && 'cron' in entry) {
      const e = entry as { cron?: unknown; prompt?: unknown }
      if (typeof e.cron === 'string') {
        expressions.push(e.cron)
        prompts.push(typeof e.prompt === 'string' && e.prompt.trim() ? e.prompt.trim() : undefined)
      }
    }
  }
  return { expressions, prompts }
}

/**
 * 将单条 yaml 条目叠加 user override 生成 AgentConfig。
 * 防御:条目必须有字符串 id,否则返回 null(调用方跳过)。
 *
 * R8-1 修复: 映射 yaml 的 mcp_servers → AgentConfig.mcpServers
 * (之前此字段在加载时丢失,导致 agent 永远拿不到 MCP 工具)
 * R6-1: override 优先(用户在 UI 配的 agent↔MCP 连接覆盖主配置)
 */
export function buildAgentConfig(a: RawAgentEntry, override?: AgentOverride): AgentConfig | null {
  // 防御单条数据畸形：必须有字符串 id
  if (!a || typeof a.id !== 'string') return null
  const { expressions, prompts } = parseScheduleEntries(a.schedule?.cron)
  return {
    id: a.id,
    name: override?.name ?? (a.name as string | undefined) ?? a.id,
    role: (a.role as string | undefined) ?? '',
    description: override?.description ?? (a.description as string | undefined) ?? '',
    enabled:
      typeof override?.enabled === 'boolean'
        ? override.enabled
        : ((a.enabled as boolean | undefined) ?? true),
    modelTier:
      override?.modelTier ?? (a.model_tier as AgentConfig['modelTier'] | undefined) ?? 'low_cost',
    schedule: expressions,
    schedulePrompts: prompts.some((p) => p !== undefined) ? prompts : undefined,
    capabilities: override?.capabilities ?? (a.capabilities as string[] | undefined) ?? [],
    riskThresholds: a.risk_thresholds as AgentConfig['riskThresholds'],
    mcpServers: override?.mcpServers ?? (a.mcp_servers as string[] | undefined),
  }
}
