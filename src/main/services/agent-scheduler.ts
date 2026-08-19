// =============================================================
// Agent 调度层 — cron 任务同步 / 用户覆盖持久化 / 下次运行时间聚合
// 从 agent-service.ts 抽出。逻辑零修改(逐行对照搬迁)。
//
// 职责边界:
//   - 持有 userOverrides Map + agentScheduleTasks Map + userOverridesPath
//   - loadUserOverrides/persistUserOverrides (agents.user.yaml, P1-2)
//   - syncSchedules (接收已过滤的 agents 数组,调 cronService.syncAgentSchedules)
//   - getNextRunAt (聚合 cronService 下次运行时间, P1-1)
//   - 不持有 agents Map 引用(syncSchedules 通过参数接收)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import yaml from 'yaml'

import { atomicWrite } from '../utils/atomic-write'
import { cronService } from './cron-service'

// 注:Override 代表"用户在某 Agent 上改过的字段"(全部可选,持久化到 agents.user.yaml),
// 区别于 AgentConfig 的完整配置,因此定义为本模块私有类型,不重复声明外部类型;
// ScheduleMap 为 agentId → cron 任务名 的映射。
type Override = {
  enabled?: boolean
  name?: string
  description?: string
  modelTier?: 'high_quality' | 'low_cost'
  capabilities?: string[]
  mcpServers?: string[]
}
type ScheduleMap = Map<string, string[]>

/** syncSchedules 接收的 agent 精简结构(只含调度需要的字段) */
export interface SchedulableAgent {
  id: string
  name: string
  schedule: string[]
  modelTier: 'high_quality' | 'low_cost'
}

export class AgentScheduler {
  private userOverrides: Map<string, Override> = new Map()
  private agentScheduleTasks: ScheduleMap = new Map()
  private readonly userOverridesPath: string

  constructor(userOverridesPath: string) {
    this.userOverridesPath = userOverridesPath
  }

  /** 读取 user override(供协调器 loadAgents 时叠加) */
  getOverride(agentId: string): Override | undefined {
    return this.userOverrides.get(agentId)
  }

  /** 设置/更新 override(供协调器 toggleAgent 等使用) */
  setOverride(id: string, patch: Override): void {
    const existing = this.userOverrides.get(id) ?? {}
    this.userOverrides.set(id, { ...existing, ...patch })
  }

  /** 删除 override(供协调器 resetAgent 等使用) */
  deleteOverride(id: string): void {
    this.userOverrides.delete(id)
  }

  /**
   * 加载 user overrides(独立 yaml,保留主 yaml 注释)
   * R6-1: 读 snake_case mcp_servers → camelCase mcpServers(与 persist 写入对称)
   */
  async loadUserOverrides(): Promise<void> {
    try {
      await fsp.access(this.userOverridesPath, fs.constants.F_OK)
    } catch {
      return
    }
    try {
      const content = await fsp.readFile(this.userOverridesPath, 'utf-8')
      const parsed = yaml.parse(content)
      const list =
        parsed && typeof parsed === 'object' && Array.isArray(parsed.agents) ? parsed.agents : []
      for (const a of list) {
        if (a && typeof a.id === 'string') {
          const override: Override = {}
          if (typeof a.enabled === 'boolean') override.enabled = a.enabled
          if (typeof a.name === 'string') override.name = a.name
          if (typeof a.description === 'string') override.description = a.description
          if (a.modelTier === 'high_quality' || a.modelTier === 'low_cost')
            override.modelTier = a.modelTier
          if (Array.isArray(a.capabilities)) override.capabilities = a.capabilities
          // R6-1: 读 snake_case mcp_servers → camelCase mcpServers(与 persist 写入对称)
          if (Array.isArray(a.mcp_servers)) override.mcpServers = a.mcp_servers
          this.userOverrides.set(a.id, override)
        }
      }
      console.log(`[AgentScheduler] Loaded ${this.userOverrides.size} user overrides`)
    } catch (err) {
      console.warn('[AgentScheduler] Failed to load user overrides:', err)
    }
  }

  /**
   * 持久化 user overrides(写回 agents.user.yaml)
   * R6-1: 持久化 mcpServers 用 snake_case mcp_servers(与加载侧一致)
   */
  async persistUserOverrides(): Promise<void> {
    const list = Array.from(this.userOverrides.entries())
      .filter(([, v]) => v && Object.keys(v).length > 0)
      .map(([id, v]) => {
        const entry: {
          id: string
          enabled?: boolean
          name?: string
          description?: string
          modelTier?: 'high_quality' | 'low_cost'
          capabilities?: string[]
          // R6-1: snake_case 与 config/agents.yaml + loadAgents 的 a.mcp_servers 对应
          mcp_servers?: string[]
        } = { id }
        if (typeof v.enabled === 'boolean') entry.enabled = v.enabled
        if (typeof v.name === 'string') entry.name = v.name
        if (typeof v.description === 'string') entry.description = v.description
        if (v.modelTier === 'high_quality' || v.modelTier === 'low_cost')
          entry.modelTier = v.modelTier
        if (Array.isArray(v.capabilities)) entry.capabilities = v.capabilities
        // R6-1: 持久化 mcpServers(用 snake_case mcp_servers 与加载侧一致)
        if (Array.isArray(v.mcpServers)) entry.mcp_servers = v.mcpServers
        return entry
      })
    const payload = `\
# Education Advisor Agent 用户覆盖配置
# 此文件由 UI 自动生成,主配置文件 config/agents.yaml 不会被修改
# 仅记录用户在 UI 中改过的字段（enabled/name/description/modelTier/capabilities/mcp_servers）
# 删除此文件可重置所有覆盖
${yaml.stringify({ agents: list })}
`
    try {
      await atomicWrite(this.userOverridesPath, payload, 'utf-8')
    } catch (err) {
      console.error('[AgentScheduler] Failed to persist user overrides:', err)
    }
  }

  /**
   * 同步 agent schedule 到 cron 任务(P1-1)。
   * 接收已过滤的 schedulable agents 数组(协调器负责从 agents Map 过滤),
   * 避免持有 agents 引用。
   */
  syncSchedules(agents: SchedulableAgent[]): void {
    this.agentScheduleTasks = cronService.syncAgentSchedules(agents)
  }

  /**
   * 聚合 agent 下所有 cron 任务的最早下次运行时间(P1-1)。
   * 返回 timestamp(ms),无任务返回 undefined。
   */
  getNextRunAt(agentId: string): number | undefined {
    const taskIds = this.agentScheduleTasks.get(agentId)
    if (!taskIds || taskIds.length === 0) return undefined
    let earliest: number | undefined
    for (const id of taskIds) {
      const iso = cronService.getNextRunAt(id)
      if (!iso) continue
      const ts = new Date(iso).getTime()
      if (Number.isFinite(ts) && (earliest === undefined || ts < earliest)) {
        earliest = ts
      }
    }
    return earliest
  }
}
