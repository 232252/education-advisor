// =============================================================
// buildSkillsSection 按 capability 过滤测试
// 覆盖: 工具交集可见性、全员工具、无 tools 声明的技能全员可见、
//       全部被过滤时返回空串、legacy 无参调用(全员)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const fakeSkills = [
    {
      name: 'WRITE_SKILL',
      description: '教写工具的技能',
      content: 'x',
      source: 'project' as const,
      filePath: '/tmp/WRITE_SKILL.md',
      tools: ['eaa_add_event', 'eaa_revert_event'],
    },
    {
      name: 'READ_SKILL',
      description: '教考试与统计的技能',
      content: 'x',
      source: 'project' as const,
      filePath: '/tmp/READ_SKILL.md',
      tools: ['eaa_exams', 'eaa_stats'],
    },
    {
      name: 'UNIVERSAL_SKILL',
      description: '教文件工具的技能',
      content: 'x',
      source: 'project' as const,
      filePath: '/tmp/UNIVERSAL_SKILL.md',
      tools: ['write_file'],
    },
    {
      name: 'OPEN_SKILL',
      description: '未声明 tools 的技能',
      content: 'x',
      source: 'project' as const,
      filePath: '/tmp/OPEN_SKILL.md',
    },
  ]
  return {
    fakeSkills,
    listSkills: vi.fn(() => fakeSkills),
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(os.tmpdir(), 'skills-filter-test')
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

vi.mock('../../src/main/services/skill-service', () => ({
  skillService: { listSkills: mocks.listSkills },
}))

import { buildSkillsSection } from '../../src/main/services/agent/tools'

describe('buildSkillsSection — 按 agent 工具集过滤', () => {
  beforeEach(() => {
    mocks.listSkills.mockClear()
  })

  it('read 类 agent: 看到考试/统计/文件/开放技能,看不到纯写技能', () => {
    const section = buildSkillsSection(['read'])
    expect(section).toContain('READ_SKILL')
    expect(section).toContain('UNIVERSAL_SKILL')
    expect(section).toContain('OPEN_SKILL')
    expect(section).not.toContain('WRITE_SKILL')
  })

  it('write 类 agent: 看到写技能,看不到考试统计技能', () => {
    const section = buildSkillsSection(['write'])
    expect(section).toContain('WRITE_SKILL')
    expect(section).not.toContain('READ_SKILL')
  })

  it('无 eaa 工具的 agent(如 capabilities:[]): 只见全员工具与开放技能', () => {
    const section = buildSkillsSection([])
    expect(section).toContain('UNIVERSAL_SKILL')
    expect(section).toContain('OPEN_SKILL')
    expect(section).not.toContain('WRITE_SKILL')
    expect(section).not.toContain('READ_SKILL')
  })

  it('单项 capability 命中即可见(academics → 考试技能)', () => {
    const section = buildSkillsSection(['academics'])
    expect(section).toContain('READ_SKILL')
    expect(section).not.toContain('WRITE_SKILL')
  })

  it('全部被过滤 → 返回空串(不输出技能段)', () => {
    mocks.listSkills.mockReturnValueOnce([mocks.fakeSkills[0]]) // 只有 WRITE_SKILL
    expect(buildSkillsSection(['read'])).toBe('')
  })

  it('legacy 无参调用 → 不过滤,全员可见', () => {
    const section = buildSkillsSection()
    expect(section).toContain('WRITE_SKILL')
    expect(section).toContain('READ_SKILL')
  })
})
