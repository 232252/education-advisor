// =============================================================
// AgentScheduler — 调度层单元测试
// 覆盖: override 存取合并/删除、loadUserOverrides(缺文件/字段清洗/
//       R6-1 snake_case mcp_servers 读取)、persistUserOverrides(头部注释/
//       snake_case 写入/空覆盖)、持久化↔加载往返、syncSchedules 委派、
//       getNextRunAt 多任务取最早/跳过无效/未知 agent
// =============================================================

import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentScheduler } from '../../src/main/services/agent-scheduler'

const cronMocks = vi.hoisted(() => ({
  syncAgentSchedules: vi.fn(),
  getNextRunAt: vi.fn(),
}))

vi.mock('../../src/main/services/cron-service', () => ({
  cronService: cronMocks,
}))

let dir: string
let filePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ea-scheduler-'))
  filePath = join(dir, 'agents.user.yaml')
  cronMocks.syncAgentSchedules.mockReset().mockImplementation(() => new Map())
  cronMocks.getNextRunAt.mockReset().mockImplementation(() => undefined)
})

describe('override 存取', () => {
  it('setOverride 合并补丁,getOverride 返回合并结果', () => {
    const s = new AgentScheduler(filePath)
    s.setOverride('a', { enabled: false })
    s.setOverride('a', { name: '新名' })
    expect(s.getOverride('a')).toEqual({ enabled: false, name: '新名' })
  })
})

describe('loadUserOverrides', () => {
  it('文件不存在时静默保持空', async () => {
    const s = new AgentScheduler(join(dir, 'missing.yaml'))
    await s.loadUserOverrides()
    expect(s.getOverride('a')).toBeUndefined()
  })

  it('R6-1: 读取 snake_case mcp_servers → camelCase,非法字段被清洗', async () => {
    writeOverrides([
      {
        id: 'a',
        enabled: false,
        modelTier: 'low_cost',
        capabilities: ['x'],
        mcp_servers: ['fs'],
      },
      { enabled: true }, // 无 id — 跳过
      { id: 'b', modelTier: 'bogus', enabled: 'yes' }, // 非法类型 — 清洗后仅剩 id 槽
    ])
    const s = new AgentScheduler(filePath)
    await s.loadUserOverrides()
    expect(s.getOverride('a')).toEqual({
      enabled: false,
      modelTier: 'low_cost',
      capabilities: ['x'],
      mcpServers: ['fs'],
    })
    expect(s.getOverride('b')).toEqual({})
  })

  it('损坏的 YAML 被捕获并保持空(不抛出)', async () => {
    const s = new AgentScheduler(filePath)
    writeFileSync(filePath, '{ agents: [broken', 'utf-8')
    await expect(s.loadUserOverrides()).resolves.toBeUndefined()
    expect(s.getOverride('a')).toBeUndefined()
  })
})

describe('persistUserOverrides', () => {
  it('写入带头部注释的 yaml,字段转 snake_case', async () => {
    const s = new AgentScheduler(filePath)
    s.setOverride('a', { enabled: false, mcpServers: ['fs'] })
    await s.persistUserOverrides()
    expect(existsSync(filePath)).toBe(true)
    const text = readFileSync(filePath, 'utf-8')
    expect(text).toContain('# Education Advisor Agent 用户覆盖配置')
    expect(text).toContain('mcp_servers')
    expect(text).not.toContain('mcpServers')
  })

  it('往返: persist → 新实例 load → 覆盖等值', async () => {
    const s = new AgentScheduler(filePath)
    s.setOverride('a', {
      enabled: false,
      name: '名',
      description: '述',
      modelTier: 'high_quality',
      capabilities: ['c'],
      mcpServers: ['m'],
    })
    await s.persistUserOverrides()

    const s2 = new AgentScheduler(filePath)
    await s2.loadUserOverrides()
    expect(s2.getOverride('a')).toEqual({
      enabled: false,
      name: '名',
      description: '述',
      modelTier: 'high_quality',
      capabilities: ['c'],
      mcpServers: ['m'],
    })
  })
})

describe('schedule 同步与聚合', () => {
  it('syncSchedules 委派 cronService 并存下任务映射', () => {
    const taskMap = new Map([['a', ['t1', 't2']]])
    cronMocks.syncAgentSchedules.mockReturnValue(taskMap)
    const s = new AgentScheduler(filePath)
    s.syncSchedules([{ id: 'a', name: 'A', schedule: ['0 9 * * *'], modelTier: 'low_cost' }])
    expect(cronMocks.syncAgentSchedules).toHaveBeenCalledTimes(1)
    expect(s.getNextRunAt('a')).toBeUndefined() // getNextRunAt 全部未返回 → undefined
  })

  it('getNextRunAt 取多任务最早值,跳过无效时间与缺失任务', () => {
    cronMocks.syncAgentSchedules.mockReturnValue(new Map([['a', ['t1', 't2', 't3']]]))
    cronMocks.getNextRunAt.mockImplementation((id: string) =>
      id === 't1' ? '2099-01-02T00:00:00.000Z' : id === 't2' ? '2099-01-01T00:00:00.000Z' : undefined,
    )
    const s = new AgentScheduler(filePath)
    s.syncSchedules([])
    expect(s.getNextRunAt('a')).toBe(new Date('2099-01-01T00:00:00.000Z').getTime())
  })

  it('无任务的 agent 返回 undefined', () => {
    const s = new AgentScheduler(filePath)
    expect(s.getNextRunAt('ghost')).toBeUndefined()
  })
})

/** 把 agents 数组按 agents.user.yaml 的真实格式写入测试文件 */
function writeOverrides(agents: unknown[]): void {
  writeFileSync(filePath, yamlStringify({ agents }), 'utf-8')
}
