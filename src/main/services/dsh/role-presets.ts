// =============================================================
// 角色预设 × 对话模式 — 正交组合（决策 A：现有机制规范化）
//
// 一个「角色预设」= 四样注入的显式描述：
//   提示词（AGENTS.md via DSH_AGENTS_HOME）+ 工具（按能力裁剪的 MCP 端点）
//   + 技能（skill-mount 目录）+ 模型档（model_tier）。
// 一个「对话模式」= 一组 cordis 行开关（chat-modes）。
// 两者正交：模式只改行开关，不改角色注入；任何角色 × 任何模式都成立。
//
// 这是把既有运行时机制收敛成显式契约（零行为变化），为未来迁移
// DSH 原生 agent-preset 预留接口：届时只需把 describeRolePreset 的
// 四样注入翻译成 preset 子行，组合逻辑不变。
// =============================================================

import { buildChatModePatch, type ChatMode, normalizeChatMode } from './chat-modes'

/** 角色预设的最小输入（AgentConfig 的结构子集，避免拖入 settings 依赖） */
export interface RolePresetSource {
  id: string
  name?: string
  modelTier?: 'high_quality' | 'low_cost'
  capabilities?: readonly string[]
}

/** 角色预设的显式描述：四样注入各走哪条既有通道 */
export interface RolePreset {
  id: string
  name: string
  /** 提示词：写进该角色 DSH_AGENTS_HOME/AGENTS.md */
  instructionsVia: 'agents-home'
  /** 工具：按 capabilities 裁剪后挂一个只含该角色工具的 MCP 端点 */
  toolsVia: 'mcp-endpoint'
  /** 技能：selectSkillsForRun → skill-mount 目录 */
  skillsVia: 'skill-mount'
  modelTier: 'high_quality' | 'low_cost'
  capabilities: readonly string[]
}

export function describeRolePreset(role: RolePresetSource): RolePreset {
  return {
    id: role.id,
    name: role.name ?? role.id,
    instructionsVia: 'agents-home',
    toolsVia: 'mcp-endpoint',
    skillsVia: 'skill-mount',
    modelTier: role.modelTier ?? 'low_cost',
    capabilities: role.capabilities ?? [],
  }
}

export interface RoleModeCombination {
  roleId: string
  mode: ChatMode
  role: RolePreset
  /** 模式行开关 patch 文本（standard 为空数组 YAML）；排在加固层之后 */
  modePatchText: string
}

/** 角色 × 模式组合：角色注入不变，模式只贡献行开关。 */
export function buildRoleModePatches(role: RolePresetSource, mode: string): RoleModeCombination {
  const normalized = normalizeChatMode(mode)
  return {
    roleId: role.id,
    mode: normalized,
    role: describeRolePreset(role),
    modePatchText: buildChatModePatch(normalized),
  }
}
