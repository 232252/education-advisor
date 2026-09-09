// =============================================================
// AgentService — loadAgents + updateAgent/toggleAgent 成功与校验分支
// (既有 agent-service.test.ts 只覆盖 not-found 分支;本文件向 constructor
//  钉住的 resources/config 写入最小 agents.yaml,驱动真实加载后的更新面:
//  capabilities/mcpServers 字符串数组校验(R6-1)、override 透传、
//  listAgents 聚合、hasAgent 语义)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    userDataDir: '',
    getPath: vi.fn((n: string) => (n === 'userData' ? mocks.userDataDir : '')),
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

const tmpRoot = path.join(os.tmpdir(), `agent-svc-upd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: class {} }))
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getEnvApiKey: vi.fn(() => ''),
  getModel: vi.fn(),
  getModels: vi.fn(() => []),
  getProviders: vi.fn(() => []),
  streamSimple: vi.fn(),
}))
vi.mock('./compaction-helper', () => ({ compactAgentMessages: vi.fn() }))
vi.mock('./cron-service', () => ({
  cronService: {
    setAgentRunner: vi.fn(),
    syncAgentSchedules: vi.fn(() => new Map()),
    getNextRunAt: vi.fn(() => undefined),
  },
}))
vi.mock('./db-service', () => ({ dbService: {} }))
vi.mock('./eaa-tools', () => ({ getToolsByCapability: vi.fn(() => []) }))
vi.mock('./file-tools', () => ({ allFileTools: [] }))
vi.mock('./keystore-service', () => ({
  keystoreService: { getApiKey: vi.fn(() => ''), getSecret: vi.fn(() => '') },
}))
vi.mock('./settings-service', () => ({
  settingsService: { getSettings: vi.fn(() => ({})) },
}))
vi.mock('./skill-service', () => ({
  skillService: { listSkills: vi.fn(() => []) },
}))
vi.mock('./utility-tools', () => ({ allUtilityTools: [] }))

import { agentService } from '../../src/main/services/agent-service'

beforeAll(async () => {
  mocks.userDataDir = userDataDir
  Object.defineProperty(process, 'resourcesPath', {
    value: path.join(tmpRoot, 'resources'),
    configurable: true,
  })
  await fsp.mkdir(userDataDir, { recursive: true })
  // 关键时序: constructor 在模块导入期已用 hoisted 阶段的 resourcesPath
  // (/tmp/fake-resources) 求值 configDir — beforeAll 再改 resourcesPath 无效。
  // 因此 yaml 必须写到 constructor 钉住的路径下。
  const configDir = path.join(os.tmpdir(), 'fake-resources', 'config')
  await fsp.mkdir(configDir, { recursive: true })
  await fsp.writeFile(
    path.join(configDir, 'agents.yaml'),
    [
      'agents:',
      '  - id: test-agent',
      '    name: 测试员',
      '    role: tester',
      '    description: 测试用',
      '    enabled: true',
      '    model_tier: low_cost',
      '    capabilities: [read]',
      '    schedule:',
      '      cron: "0 9 * * 1"',
      '  - id: plain-agent',
      '    name: 无调度',
      '    enabled: true',
      '',
    ].join('\n'),
    'utf-8',
  )
  await agentService.loadAgents()
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('loadAgents', () => {
  it('加载 yaml 条目并映射字段', () => {
    expect(agentService.hasAgent('test-agent')).toBe(true)
    expect(agentService.hasAgent('plain-agent')).toBe(true)
  })

  it('hasAgent: 未加载/空串/非字符串 → false', () => {
    expect(agentService.hasAgent('ghost')).toBe(false)
    expect(agentService.hasAgent('')).toBe(false)
    expect(agentService.hasAgent(undefined as never)).toBe(false)
  })

  it('listAgents: 映射 status 默认 idle', () => {
    const list = agentService.listAgents()
    const a = list.find((x) => x.id === 'test-agent')
    expect(a).toMatchObject({ name: '测试员', enabled: true, status: 'idle' })
  })
})

describe('updateAgent 校验分支(真实已加载 agent)', () => {
  it('capabilities 非数组 → 拒绝且不落 override', () => {
    const r = agentService.updateAgent('test-agent', {
      capabilities: 'read' as never,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/capabilities/)
  })

  it('mcpServers 含非字符串项 → 拒绝(R6-1)', () => {
    const r = agentService.updateAgent('test-agent', {
      mcpServers: ['ok', 123] as never,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/mcpServers/)
  })

  it('合法 patch → 成功并透传 override 持久化', () => {
    const r = agentService.updateAgent('test-agent', {
      description: '更新后描述',
      modelTier: 'high_quality',
      mcpServers: ['fs'],
    })
    expect(r.success).toBe(true)
    const detail = agentService.listAgents().find((x) => x.id === 'test-agent')
    expect(detail).toMatchObject({ description: '更新后描述', modelTier: 'high_quality' })
  })

  it('不存在的 agent → 拒绝', () => {
    expect(agentService.updateAgent('ghost', { name: 'x' }).success).toBe(false)
  })
})

describe('toggleAgent(真实已加载 agent)', () => {
  it('禁用后 enabled 翻转,再启用恢复', () => {
    expect(agentService.toggleAgent('plain-agent', false).success).toBe(true)
    expect(agentService.listAgents().find((x) => x.id === 'plain-agent')?.enabled).toBe(false)
    expect(agentService.toggleAgent('plain-agent', true).success).toBe(true)
    expect(agentService.listAgents().find((x) => x.id === 'plain-agent')?.enabled).toBe(true)
  })

  it('未加载 fs 时 agents.user.yaml 不存在也不报错(容错)', () => {
    expect(fs.existsSync(path.join(userDataDir, 'agents.user.yaml.done'))).toBe(false)
  })
})
