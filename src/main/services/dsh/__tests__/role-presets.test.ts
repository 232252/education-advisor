// =============================================================
// 角色预设 × 对话模式 — 正交组合（决策 A：现有机制规范化）
//
// 角色 = 提示词(AGENTS.md) + 能力裁剪工具 + 技能目录 + 模型档；
// 模式 = 一组 cordis 行开关。两者正交：组合补丁 = 模式行开关，
// 角色注入不受模式影响；任何角色 × 任何模式都成立。
// =============================================================

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { CHAT_MODES } from '../chat-modes'
import { buildRoleModePatches, describeRolePreset } from '../role-presets'

const ROLE = {
  id: 'weekly-reporter',
  name: '周报助手',
  modelTier: 'low_cost' as const,
  capabilities: ['read', 'report'],
}

describe('角色预设描述符', () => {
  it('显式列出角色的四样注入（提示词/工具/技能/模型档）', () => {
    const preset = describeRolePreset(ROLE)
    expect(preset.id).toBe('weekly-reporter')
    expect(preset.instructionsVia).toBe('agents-home')
    expect(preset.toolsVia).toBe('mcp-endpoint')
    expect(preset.skillsVia).toBe('skill-mount')
    expect(preset.modelTier).toBe('low_cost')
    expect(preset.capabilities).toEqual(['read', 'report'])
  })
})

describe('角色 × 模式正交组合', () => {
  it('每个角色 × 每个模式都成立，模式行开关与角色无关', () => {
    for (const mode of CHAT_MODES) {
      const combined = buildRoleModePatches(ROLE, mode)
      expect(combined.roleId).toBe('weekly-reporter')
      expect(combined.mode).toBe(mode)
      // 角色注入路径不随模式变化
      expect(combined.role.instructionsVia).toBe('agents-home')
      const rows = parse(combined.modePatchText) as Array<{ id?: string }>
      if (mode === 'standard') expect(rows).toEqual([])
      if (mode === 'plan') expect(rows.map((r) => r.id)).toEqual(['plan-mode'])
      if (mode === 'ptc')
        expect(rows.map((r) => r.id)).toEqual(['tool-executor-native', 'tool-executor-ptc'])
    }
  })

  it('未知模式回落 standard，不炸', () => {
    const combined = buildRoleModePatches(ROLE, 'bogus')
    expect(combined.mode).toBe('standard')
    expect(parse(combined.modePatchText)).toEqual([])
  })
})
