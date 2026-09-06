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

  it('addEntry 持久化并可往返读取', async () => {
    const e1 = await svc.addEntry('main', '用户偏好简洁回复', 'user_preference')
    const e2 = await svc.addEntry('main', '张三的数学需要重点关注', 'fact')
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

  it('deleteEntry / clear 生效', async () => {
    const entries = svc.listEntries('main')
    expect(await svc.deleteEntry('main', entries[0].id)).toBe(true)
    expect(await svc.deleteEntry('main', 'nonexistent')).toBe(false)
    expect(svc.listEntries('main')).toHaveLength(1)
    await svc.clear('main')
    expect(svc.listEntries('main')).toHaveLength(0)
  })

  it('不同 agent 的记忆相互隔离', async () => {
    await svc.addEntry('main', 'main 的记忆')
    await svc.addEntry('academic', 'academic 的记忆')
    expect(svc.listEntries('main').map((e) => e.content)).toEqual(['main 的记忆'])
    expect(svc.listEntries('academic').map((e) => e.content)).toEqual(['academic 的记忆'])
  })

  it('超长内容被截断到 500 字符', async () => {
    const e = await svc.addEntry('academic', 'x'.repeat(1000))
    expect(e.content).toHaveLength(500)
  })

  it('损坏的 JSON 文件按空记忆处理(不抛错)', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory', 'bug-hunter.json'), '{broken json', 'utf-8')
    expect(svc.listEntries('bug-hunter')).toHaveLength(0)
    expect(svc.getMemorySection('bug-hunter')).toBe('')
  })

  it('非法 agentId 被拒绝(防路径穿越)', async () => {
    // 读取路径: 静默返回空(fail-safe)
    expect(svc.listEntries('../evil')).toEqual([])
    // 写入路径: 抛错拦截
    await expect(svc.addEntry('../evil', '内容')).rejects.toThrow(/Invalid agent id/)
  })
})

describe('MemoryService 注入上限', () => {
  it('注入段落最多 30 条且总长受限', async () => {
    for (let i = 0; i < 40; i++) await svc.addEntry('counselor', `记忆条目 ${i}`)
    const section = svc.getMemorySection('counselor')
    const lines = section.split('\n').filter((l) => l.startsWith('- ['))
    expect(lines).toHaveLength(30)
    // 最近 30 条: 含条目 10..39, 不含 0..9
    expect(section).toContain('记忆条目 39')
    expect(section).toContain('记忆条目 10')
    expect(section).not.toContain('记忆条目 9')
    expect(section.length).toBeLessThanOrEqual(4000 + 200 /* 段落头 */)
  })

  it('注入顺序保持时间升序(最旧在前)', async () => {
    await svc.clear('order-test')
    await svc.addEntry('order-test', '较早的记忆甲')
    await svc.addEntry('order-test', '较晚的记忆乙')
    const section = svc.getMemorySection('order-test')
    expect(section.indexOf('较早的记忆甲')).toBeLessThan(section.indexOf('较晚的记忆乙'))
  })

  it('预算超限时优先保留最新记忆(截断方向: 丢最旧)', async () => {
    await svc.clear('budget-test')
    // 每行约 150 字符 × 30 条 > 4000 预算,必然触发截断
    for (let i = 0; i < 40; i++) await svc.addEntry('budget-test', `事实${i}:${'很'.repeat(120)}`)
    const section = svc.getMemorySection('budget-test')
    expect(section).toContain('事实39') // 最新的一条必须在
    expect(section).not.toContain('事实0') // 最旧的被丢
  })

  it('注入截断优先在句末标点断开(不拦腰截断反转语义)', async () => {
    await svc.clear('sentence-test')
    // 内容 > 200 字符,句号在前 200 字符内出现,否定语义整句留在截断点之后
    const content = `${'张三上课认真听讲,作业按时完成。'.repeat(15)}张三不再是重点关注对象`
    await svc.addEntry('sentence-test', content)
    const section = svc.getMemorySection('sentence-test')
    expect(section).toContain('…')
    expect(section).not.toContain('不再是重点关注对象') // 后半句应被整体截掉
  })

  it('相同内容重复保存时去重(刷新时间而不新增)', async () => {
    await svc.clear('dedup-test')
    const first = await svc.addEntry('dedup-test', '用户偏好简洁回复', 'user_preference')
    const second = await svc.addEntry('dedup-test', '用户偏好简洁回复', 'user_preference')
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
    expect(svc.listEntries('dedup-test')).toHaveLength(1)
    // 时间戳被刷新: 排到数组尾部(注入选取的"最近"端)
    expect(svc.listEntries('dedup-test')[0].createdAt).toBeGreaterThanOrEqual(first.createdAt)
  })

  it('仅空白差异的内容视为重复', async () => {
    await svc.clear('dedup-test2')
    await svc.addEntry('dedup-test2', '李四的家长习惯微信联系')
    const again = await svc.addEntry('dedup-test2', '李四的家长 习惯 微信联系')
    expect(again.deduped).toBe(true)
    expect(svc.listEntries('dedup-test2')).toHaveLength(1)
  })

  it('task 类备忘超过 14 天未重新保存不再注入(其余类别不受时效限制)', async () => {
    await svc.clear('ttl-test')
    const fresh = await svc.addEntry('ttl-test', '待办: 给张三家长回电话', 'task')
    const staleTask = await svc.addEntry('ttl-test', '旧待办: 整理期中名单', 'task')
    const fact = await svc.addEntry('ttl-test', '李四需重点关注数学', 'fact')
    // 把旧 task 与其他条目的时间戳回拨 20 天
    const twentyDaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000
    const file = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'memory', 'ttl-test.json'), 'utf-8'),
    ) as { entries: Array<{ id: string; createdAt: number }> }
    for (const e of file.entries) {
      if (e.id === staleTask.id || e.id === fact.id) e.createdAt = twentyDaysAgo
    }
    fs.writeFileSync(
      path.join(tmpDir, 'memory', 'ttl-test.json'),
      JSON.stringify(file, null, 2),
      'utf-8',
    )

    const section = svc.getMemorySection('ttl-test')
    expect(section).toContain('待办: 给张三家长回电话') // 新 task 注入
    expect(section).not.toContain('旧待办: 整理期中名单') // 过期 task 被滤除
    expect(section).toContain('李四需重点关注数学') // fact 不受时效限制
    void fresh
  })
})
