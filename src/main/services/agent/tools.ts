// =============================================================
// Agent 运行时工具集构造 + Skill 注入
// 从 agent-service.ts 下沉(纯重构,行为零变化):
//   - buildSkillsSection: 将可用 skill 格式化为 system prompt 段落
//   - buildAgentTools:    构造 EAA + 文件 + 实用 + MCP 工具集
// M32: buildAgentTools 增加委托桥接参数,delegate_to 只注入 main
// 后续扩展:
//   - save_memory: 所有 agent 获得(长期记忆写入入口,读取走 system prompt 注入)
//   - escalate_to_main: 声明 'escalate' capability 的安全类 agent 获得
//   - privacyGuard: 开启自动脱敏时包装 EAA 工具(入参化名→真名,结果真名→化名)
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
import {
  createEscalateToMainTool,
  ESCALATE_CAPABILITY,
  type EscalationToolDeps,
} from './escalation-tool'
import { createMemoryTool } from './memory-tool'
import type { PrivacyGuard } from './privacy-guard'

/** 将所有可用 skill 格式化为 system prompt 段落 */
export function buildSkillsSection(): string {
  const skills = skillService.listSkills()
  if (skills.length === 0) return ''

  const entries = skills.map((s) => {
    // 只输出名称和描述摘要，不注入完整内容（节省 token）。
    // 附上文件路径,agent 需要时可自行 read_file 读取全文 —
    // 此前只给名字,agent 实际上没有途径读到技能正文。
    return `### ${s.name}\n${s.description}\n(完整内容: 用 read_file 读取 "${s.filePath}")`
  })

  return `\n--- 可用技能 ---\n${entries.join('\n\n')}`
}

// R2-07 脱敏旁路封堵:只读类文件工具经 wrapTool 包装(结果真名→化名回流上下文);
// 写类工具(write_file/write_excel/write_csv)不包装 — 本地落盘保留真名是安全方向,
// 且模型把化名写进导出文件会直接产出废纸。
const READ_SIDE_FILE_TOOL_NAMES = new Set(['read_file', 'read_excel', 'list_dir'])

/**
 * 构造 Agent 运行时工具集(EAA + 文件 + 实用 + 记忆 + MCP)
 *
 * MCP 集成:合并三层配置(全局 mcp.yaml + Agent 级 mcpServers + 技能级临时 server)
 * MCP 未启用或无配置时返回空数组,不影响现有工具
 *
 * M32: delegate_to 轻量路由 — 仅当 delegateDeps 提供且 id 为 main 时注入
 * (其他角色不获得该工具,防递归风暴);委托桥接实现见 agent/delegate-tool.ts
 *
 * escalate_to_main — 仅当声明 'escalate' capability 时注入(psychology/risk-alert/safety)
 *
 * privacyGuard 非空时(开启自动脱敏的运行),EAA 工具 + 只读文件工具 + MCP 工具
 * 经 wrapTool 包装:模型用化名调用工具 → 入参还原为真名执行 → 结果再脱敏回流模型上下文。
 * R2-07 此前只有 EAA 工具被包装,read_excel 读成绩表可整表绕过脱敏(旁路)。
 */
export async function buildAgentTools(
  config: AgentConfig,
  id: string,
  win?: BrowserWindow,
  delegateDeps?: DelegateToolDeps,
  escalationDeps?: EscalationToolDeps,
  privacyGuard?: PrivacyGuard,
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
): Promise<AgentTool<any>[]> {
  const mcpTools = await getMcpToolsForAgent(id, config.mcpServers)
  const rawEaaTools = getToolsByCapability(config.capabilities)
  const eaaTools = privacyGuard ? rawEaaTools.map((t) => privacyGuard.wrapTool(t)) : rawEaaTools
  // R2-07: 只读文件工具纳入脱敏包装;MCP 是外部扩展宁可过保护 — 全部包装
  const fileTools = privacyGuard
    ? allFileTools.map((t) =>
        READ_SIDE_FILE_TOOL_NAMES.has(t.name) ? privacyGuard.wrapTool(t) : t,
      )
    : allFileTools
  const guardedMcpTools = privacyGuard ? mcpTools.map((t) => privacyGuard.wrapTool(t)) : mcpTools
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  const tools: AgentTool<any>[] = [
    ...eaaTools,
    ...fileTools, // 文件工具（read_file, read_excel, write_excel, write_csv, list_dir）
    ...allUtilityTools, // 实用工具（get_current_time, calculate）
    createMemoryTool(id, privacyGuard), // save_memory — 长期记忆写入(所有角色;落盘前化名→真名)
    ...guardedMcpTools, // MCP 工具(动态注入,工具名前缀 mcp_<serverId>_)
  ]
  if (delegateDeps && id === DELEGATE_SOURCE_AGENT_ID) {
    tools.push(createDelegateToTool(delegateDeps, { sourceAgentId: id, win }))
  }
  const capSet = new Set(config.capabilities.map((c) => c.toLowerCase()))
  if (escalationDeps && capSet.has(ESCALATE_CAPABILITY)) {
    tools.push(createEscalateToMainTool(escalationDeps, { sourceAgentId: id }))
  }
  return tools
}
