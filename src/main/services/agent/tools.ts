// =============================================================
// Agent 运行时工具集构造 + Skill 注入
// 从 agent-service.ts 下沉(纯重构,行为零变化):
//   - buildSkillsSection: 将可用 skill 格式化为 system prompt 段落
//   - buildAgentTools:    构造 EAA + 文件 + 实用 + MCP 工具集
// M32: buildAgentTools 增加委托桥接参数,delegate_to 只注入 main
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentConfig } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { getToolsByCapability } from '../eaa-tools'
import { allFileTools } from '../file-tools'
import { getMcpToolsForAgent } from '../mcp-management/tools/aggregate'
import { skillService } from '../skill-service'
import { allUtilityTools } from '../utility-tools'
import {
  createDelegateToTool,
  DELEGATE_SOURCE_AGENT_ID,
  type DelegateToolDeps,
} from './delegate-tool'

/** 将所有可用 skill 格式化为 system prompt 段落 */
export function buildSkillsSection(): string {
  const skills = skillService.listSkills()
  if (skills.length === 0) return ''

  const entries = skills.map((s) => {
    // 只输出名称和描述摘要，不注入完整内容（节省 token）
    // Agent 可通过文件读取工具获取完整内容
    return `### ${s.name}\n${s.description}`
  })

  return `\n--- 可用技能 ---\n${entries.join('\n\n')}`
}

/**
 * 构造 Agent 运行时工具集(EAA + 文件 + 实用工具 + MCP)
 *
 * MCP 集成:合并三层配置(全局 mcp.yaml + Agent 级 mcpServers + 技能级临时 server)
 * MCP 未启用或无配置时返回空数组,不影响现有工具
 *
 * M32: delegate_to 轻量路由 — 仅当 delegateDeps 提供且 id 为 main 时注入
 * (其他角色不获得该工具,防递归风暴);委托桥接实现见 agent/delegate-tool.ts
 */
export async function buildAgentTools(
  config: AgentConfig,
  id: string,
  win?: BrowserWindow,
  delegateDeps?: DelegateToolDeps,
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
): Promise<AgentTool<any>[]> {
  const mcpTools = await getMcpToolsForAgent(id, config.mcpServers)
  const tools: AgentTool<any>[] = [
    ...getToolsByCapability(config.capabilities),
    ...allFileTools, // 文件工具（read_file, read_excel, write_excel, write_csv, list_dir）
    ...allUtilityTools, // 实用工具（get_current_time, calculate）
    ...mcpTools, // MCP 工具(动态注入,工具名前缀 mcp_<serverId>_)
  ]
  if (delegateDeps && id === DELEGATE_SOURCE_AGENT_ID) {
    tools.push(createDelegateToTool(delegateDeps, { sourceAgentId: id, win }))
  }
  return tools
}
