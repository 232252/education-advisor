// =============================================================
// Memory Service 测试 — 持久化记忆(存储 + 注入段落)
// 覆盖: (a) 增/删/清空 CRUD 与持久化往返
//       (b) getMemorySection 格式化与条数/长度上限
//       (c) 空/损坏文件防御
// mock 模式参考 tests/main/agent-delegate-tool.test.ts
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

import { MemoryService } from '../../src/main/services/agent/memory-service'

let tmpDir = ''
let svc: InstanceType<typeof MemoryService>

beforeAll(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eaa-memory-test-'))
  mocks.userDataDir = tmpDir
  svc = new MemoryService(path.join(tmpDir, 'memory'))
})

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

describe('MemoryService CRUD', () => {
  it('空 agent 返回空记忆段落', () => {
    expect(svc.listEntries('main')).toHaveLength(0)
    expect(svc.getMemorySection('main')).toBe('')
  })

  it('addEntry 持久化并可往返读取', () => {
    const e1 = svc.addEntry('main', '用户偏好简洁回复', 'user_preference')
    const e2 = svc.addEntry('main', '张三的数学需要重点关注', 'fact')
    expect(e1.id).not.toBe(e2.id)

    const fresh = new MemoryService(path.join(tmpDir, 'memory'))
    const entries = fresh.listEntries('main')
    expect(entries).toHaveLength(2)
    expect(entries[0].content).toBe('用户偏好简洁回复')
    expect(entries[0].category).toBe('user_preference')

    const section = fresh.getMemorySection('main')
    expect(section).toContain('--- 长期记忆 ---')
    expect(section).toContain('用户偏好简洁回复')
    expect(section).toContain('张三的数学需要重点关注')
  })

  it('deleteEntry / clear 生效', () => {
    const entries = svc.listEntries('main')
    expect(svc.deleteEntry('main', entries[0].id)).toBe(true)
    expect(svc.deleteEntry('main', 'nonexistent')).toBe(false)
    expect(svc.listEntries('main')).toHaveLength(1)
    svc.clear('main')
    expect(svc.listEntries('main')).toHaveLength(0)
  })

  it('不同 agent 的记忆相互隔离', () => {
    svc.addEntry('main', 'main 的记忆')
    svc.addEntry('academic', 'academic 的记忆')
    expect(svc.listEntries('main').map((e) => e.content)).toEqual(['main 的记忆'])
    expect(svc.listEntries('academic').map((e) => e.content)).toEqual(['academic 的记忆'])
  })

  it('超长内容被截断到 500 字符', () => {
    const e = svc.addEntry('academic', 'x'.repeat(1000))
    expect(e.content).toHaveLength(500)
  })

  it('损坏的 JSON 文件按空记忆处理(不抛错)', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory', 'bug-hunter.json'), '{broken json', 'utf-8')
    expect(svc.listEntries('bug-hunter')).toHaveLength(0)
    expect(svc.getMemorySection('bug-hunter')).toBe('')
  })

  it('非法 agentId 被拒绝(防路径穿越)', () => {
    // 读取路径: 静默返回空(fail-safe)
    expect(svc.listEntries('../evil')).toEqual([])
    // 写入路径: 抛错拦截
    expect(() => svc.addEntry('../evil', '内容')).toThrow(/Invalid agent id/)
  })
})

describe('MemoryService 注入上限', () => {
  it('注入段落最多 30 条且总长受限', () => {
    for (let i = 0; i < 40; i++) svc.addEntry('counselor', `记忆条目 ${i}`)
    const section = svc.getMemorySection('counselor')
    const lines = section.split('\n').filter((l) => l.startsWith('- ['))
    expect(lines).toHaveLength(30)
    // 最近 30 条: 含条目 10..39, 不含 0..9
    expect(section).toContain('记忆条目 39')
    expect(section).toContain('记忆条目 10')
    expect(section).not.toContain('记忆条目 9')
    expect(section.length).toBeLessThanOrEqual(4000 + 200 /* 段落头 */)
  })
})
