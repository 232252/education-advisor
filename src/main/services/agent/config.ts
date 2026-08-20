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
  schedule?: { cron?: unknown }
  capabilities?: unknown
  risk_thresholds?: unknown
  mcp_servers?: unknown
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
    schedule: (a.schedule?.cron as string[] | undefined) ?? [],
    capabilities: override?.capabilities ?? (a.capabilities as string[] | undefined) ?? [],
    riskThresholds: a.risk_thresholds as AgentConfig['riskThresholds'],
    mcpServers: override?.mcpServers ?? (a.mcp_servers as string[] | undefined),
  }
}
