// =============================================================
// AgentService — validateAgentId / toggleAgent / updateAgent / getSoul / getRules 测试
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  // Must set process.resourcesPath before any import that touches AgentService constructor
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

const tmpRoot = path.join(os.tmpdir(), `agent-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: class { }, }))
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
  // Set process.resourcesPath for constructor (prod fallback paths)
  Object.defineProperty(process, 'resourcesPath', { value: path.join(tmpRoot, 'resources'), configurable: true })
  await fsp.mkdir(userDataDir, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('AgentService — validateAgentId 路径遍历防护', () => {
  const invalidIds = [
    '../../../etc/passwd',
    '..\\\\..\\\\windows\\\\system32',
    'a/b/c',
    'A B C',
    'agent with spaces',
    'test.db',
    '',
    'UPPER',
    '中文',
    'test+plus',
    'test;rm -rf',
    'test$HOME',
    'a|b',
    'a&b',
    'a`b`',
    'test\x00null',
  ]

  for (const badId of invalidIds) {
    it(`getSoul 拒绝非法 id: ${JSON.stringify(badId)}`, () => {
      expect(() => agentService.getSoul(badId)).toThrow(/Invalid agent id/)
    })
    it(`getRules 拒绝非法 id: ${JSON.stringify(badId)}`, () => {
      expect(() => agentService.getRules(badId)).toThrow(/Invalid agent id/)
    })
    it(`setSoul 拒绝非法 id: ${JSON.stringify(badId)}`, () => {
      expect(() => agentService.setSoul(badId, 'x')).toThrow(/Invalid agent id/)
    })
    it(`setRules 拒绝非法 id: ${JSON.stringify(badId)}`, () => {
      expect(() => agentService.setRules(badId, 'x')).toThrow(/Invalid agent id/)
    })
  }

  const validIds = ['main', 'test-agent', 'agent_1', 'a0', 'x-y_z', '123', 'a-b-c_d-e_f-0']
  for (const goodId of validIds) {
    it(`getSoul 接受合法 id: ${goodId} (返回字符串)`, () => {
      expect(typeof agentService.getSoul(goodId)).toBe('string')
    })
    it(`getRules 接受合法 id: ${goodId} (返回字符串)`, () => {
      expect(typeof agentService.getRules(goodId)).toBe('string')
    })
  }
})

describe('AgentService — toggleAgent', () => {
  it('不存在的 agent → { success: false, error: "Agent not found" }', () => {
    const r = agentService.toggleAgent('nonexistent-agent-xyz', true)
    expect(r.success).toBe(false)
    expect(r.error).toContain('not found')
  })

  it('不存在的 agent → toggle false 也返回失败', () => {
    const r = agentService.toggleAgent('another-nonexistent', false)
    expect(r.success).toBe(false)
  })
})

describe('AgentService — updateAgent', () => {
  it('不存在的 agent → 失败', () => {
    const r = agentService.updateAgent('no-such-id', { name: 'X' })
    expect(r.success).toBe(false)
  })

  it('不存在的 agent → 部分更新失败', () => {
    const r = agentService.updateAgent('ghost', { description: 'ghost desc' })
    expect(r.success).toBe(false)
  })
})

describe('AgentService — getAgent', () => {
  it('不存在的 agent → null', async () => {
    const r = await agentService.getAgent('totally-nonexistent-id')
    expect(r).toBeNull()
  })
})

describe('AgentService — getHistory', () => {
  it('无历史 → 空数组', () => {
    expect(agentService.getHistory('never-run')).toEqual([])
  })

  it('不同 agent 各自独立历史', () => {
    expect(agentService.getHistory('a')).toEqual([])
    expect(agentService.getHistory('b')).toEqual([])
  })
})

describe('AgentService — getSoul/getRules 文件不存在返回空串', () => {
  it('getSoul 不存在的 agent 目录 → ""', () => {
    expect(agentService.getSoul('nonexistent-valid-id')).toBe('')
  })

  it('getRules 不存在的 agent 目录 → ""', () => {
    expect(agentService.getRules('nonexistent-valid-id')).toBe('')
  })
})

describe('AgentService — setSoul/setRules 写入后读取', () => {
  it('setSoul → getSoul roundtrip', () => {
    const content = '# SOUL\n这是 agent 的灵魂\n第二行'
    agentService.setSoul('test-write-agent', content)
    expect(agentService.getSoul('test-write-agent')).toBe(content)
  })

  it('setRules → getRules roundtrip', () => {
    const content = '# AGENTS\n规则1\n规则2'
    agentService.setRules('test-write-agent', content)
    expect(agentService.getRules('test-write-agent')).toBe(content)
  })

  it('setSoul 覆盖已有内容', () => {
    agentService.setSoul('test-overwrite', 'original')
    agentService.setSoul('test-overwrite', 'updated')
    expect(agentService.getSoul('test-overwrite')).toBe('updated')
  })

  it('setSoul 空字符串', () => {
    agentService.setSoul('test-empty', '')
    expect(agentService.getSoul('test-empty')).toBe('')
  })

  it('setSoul 多行内容保留换行', () => {
    const multi = 'line1\nline2\nline3\n'
    agentService.setSoul('test-multi', multi)
    expect(agentService.getSoul('test-multi')).toBe(multi)
  })

  it('setSoul 特殊字符', () => {
    const special = 'emoji: 🎉\n中文内容\n\ttab indent'
    agentService.setSoul('test-special', special)
    expect(agentService.getSoul('test-special')).toBe(special)
  })
})
