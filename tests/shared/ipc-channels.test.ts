// =============================================================
// IPC Channels — 一致性测试
// 验证: 所有 IPC 通道常量都是唯一的非空字符串(无重复)
// 重复的通道名会导致 IPC 路由冲突,是隐蔽 bug
// =============================================================

import { describe, expect, it } from 'vitest'
import * as IPC from '../../src/shared/ipc-channels'

describe('IPC Channels — 唯一性与格式', () => {
  const entries = Object.entries(IPC) as [string, string][]
  const channelValues = entries.map(([, v]) => v)

  it('应有大量通道常量(>80)', () => {
    expect(entries.length).toBeGreaterThan(80)
  })

  it('所有值应为非空字符串', () => {
    for (const [k, v] of entries) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })

  it('所有通道值应唯一(无重复)', () => {
    const seen = new Map<string, string>()
    const dups: string[] = []
    for (const [k, v] of entries) {
      if (seen.has(v)) {
        dups.push(`${k} === ${seen.get(v)} (="${v}")`)
      }
      seen.set(v, k)
    }
    expect(dups).toEqual([])
  })

  it('所有通道值应使用冒号分隔的命名空间格式(如 agent:list)', () => {
    const bad = channelValues.filter((v) => !v.includes(':'))
    expect(bad).toEqual([])
  })

  it('通道值不应含空格', () => {
    const bad = channelValues.filter((v) => v.includes(' '))
    expect(bad).toEqual([])
  })

  it('通道值应全小写(kebab-case)', () => {
    const bad = channelValues.filter((v) => v !== v.toLowerCase())
    expect(bad).toEqual([])
  })

  it('通道值长度应合理(<50 字符)', () => {
    const bad = channelValues.filter((v) => v.length > 50)
    expect(bad).toEqual([])
  })
})

describe('IPC Channels — 命名空间分组', () => {
  const entries = Object.entries(IPC) as [string, string][]

  it('应包含 ai: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('ai:'))).toBe(true)
  })

  it('应包含 agent: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('agent:'))).toBe(true)
  })

  it('应包含 eaa: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('eaa:'))).toBe(true)
  })

  it('应包含 settings: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('settings:'))).toBe(true)
  })

  it('应包含 cron: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('cron:'))).toBe(true)
  })

  it('应包含 class: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('class:'))).toBe(true)
  })

  it('应包含 privacy: 命名空间', () => {
    expect(entries.some(([, v]) => v.startsWith('privacy:'))).toBe(true)
  })

  it('每个命名空间内的通道数应合理(>=2)', () => {
    const namespaces = new Map<string, number>()
    for (const [, v] of entries) {
      const ns = v.split(':')[0]
      namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1)
    }
    for (const [ns, count] of namespaces) {
      expect(count).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('IPC Channels — 关键常量存在性', () => {
  it('AI 聊天流相关通道存在', () => {
    expect(IPC.IPC_AI_CHAT_STREAM).toBeDefined()
    expect(IPC.IPC_AI_CHAT_ABORT).toBeDefined()
  })

  it('Agent 运行/状态通道存在', () => {
    expect(IPC.IPC_AGENT_RUN_MANUAL).toBeDefined()
    expect(IPC.IPC_AGENT_STATUS_UPDATE).toBeDefined()
    expect(IPC.IPC_AGENT_ABORT).toBeDefined()
  })

  it('EAA 核心数据通道存在', () => {
    expect(IPC.IPC_EAA_LIST_STUDENTS).toBeDefined()
    expect(IPC.IPC_EAA_ADD_EVENT).toBeDefined()
    expect(IPC.IPC_EAA_RANKING).toBeDefined()
    expect(IPC.IPC_EAA_SUMMARY).toBeDefined()
  })

  it('隐私引擎通道存在', () => {
    expect(IPC.IPC_PRIVACY_INIT).toBeDefined()
    expect(IPC.IPC_PRIVACY_LIST).toBeDefined()
  })

  it('Cron 任务通道存在', () => {
    expect(IPC.IPC_CRON_ADD).toBeDefined()
    expect(IPC.IPC_CRON_RUN_NOW).toBeDefined()
  })
})
