// =============================================================
// EAA Bridge — 读缓存写序号校验测试 (M13 修复)
// 验证: 读命令 in-flight 期间插队写命令后,旧快照不得写入读缓存
// (否则旧数据驻留缓存 10s,教师刚录入的数据看板不更新)
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-cacherace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')

class MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  killed = false
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
  kill() {
    this.killed = true
  }
}

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  spawnImpl: vi.fn((_cmd: string, _args: string[], _options?: unknown) => new MockChildProcess()),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: mocks.isPackaged },
}))

vi.mock('cross-spawn', () => ({
  default: mocks.spawnImpl,
  __esModule: true,
}))

function isEaaBinaryPath(p: string): boolean {
  return (
    (p.includes('eaa-binaries') && (p.endsWith('eaa.exe') || p.endsWith('eaa'))) ||
    (p.includes('eaa-cli') && (p.endsWith('eaa.exe') || p.endsWith('eaa')))
  )
}

let existsSpy: ReturnType<typeof vi.spyOn> | null = null

/** 等待 spawnImpl 被调用到第 expected 次(或超时) */
async function waitForSpawnCount(expected: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (mocks.spawnImpl.mock.calls.length < expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for spawn #${expected}, got ${mocks.spawnImpl.mock.calls.length}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** 用成功 JSON 输出结束一个 mock 进程 */
function completeWithJson(proc: MockChildProcess, json: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(json)))
  proc.emit('close', 0)
}

beforeAll(async () => {
  await fsp.mkdir(userDataDir, { recursive: true })
  const origExists = fs.existsSync.bind(fs)
  existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const ps = typeof p === 'string' ? p : ''
    if (isEaaBinaryPath(ps)) return true
    return origExists(p)
  })
})

afterAll(async () => {
  existsSpy?.mockRestore()
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('EAA Bridge — M13 读缓存写序号校验', () => {
  it('读 in-flight 期间插队写命令 → 旧快照不得入缓存(下次读重新 spawn)', async () => {
    vi.resetModules()
    mocks.spawnImpl.mockClear()

    // 每次调用返回受控的新 mock 进程,由测试手动驱动结束
    const procs: MockChildProcess[] = []
    mocks.spawnImpl.mockImplementation(() => {
      const proc = new MockChildProcess()
      procs.push(proc)
      return proc
    })

    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    // 1) 发起读命令 list(不 await,保持 in-flight)
    const read1 = bridge.execute({ command: 'list', args: [] })
    await waitForSpawnCount(1)
    expect(procs.length).toBe(1)

    // 2) 读 in-flight 期间插队一个写命令 add(自动完成)
    const write = bridge.execute({ command: 'add', args: ['add'] })
    await waitForSpawnCount(2)
    // 写命令 spawn 后立即完成
    completeWithJson(procs[1], { ok: true })
    await write
    expect(write).resolves // 已 await,不 reject 即可

    // 3) 此时完成读命令(返回的是写命令开始前的旧快照)
    completeWithJson(procs[0], { result: 'old-snapshot' })
    const r1 = await read1
    expect(r1.success).toBe(true)

    // 4) 再次读同命令: 若 M13 修复生效,旧快照未入缓存 → 重新 spawn(第 3 次)
    const read2 = bridge.execute({ command: 'list', args: [] })
    await waitForSpawnCount(3)
    expect(mocks.spawnImpl.mock.calls.length).toBe(3)
    completeWithJson(procs[2], { result: 'fresh' })
    const r2 = await read2
    expect(r2.success).toBe(true)
  })

  it('无写命令插队时读结果正常入缓存(第二次读不 spawn)', async () => {
    vi.resetModules()
    mocks.spawnImpl.mockClear()

    const procs: MockChildProcess[] = []
    mocks.spawnImpl.mockImplementation(() => {
      const proc = new MockChildProcess()
      procs.push(proc)
      return proc
    })

    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    // 1) 读命令完成 → 结果入缓存
    const read1 = bridge.execute({ command: 'list', args: [] })
    await waitForSpawnCount(1)
    completeWithJson(procs[0], { result: 'v1' })
    const r1 = await read1
    expect(r1.success).toBe(true)

    // 2) TTL 内再读: 命中缓存,不 spawn
    const read2 = bridge.execute({ command: 'list', args: [] })
    await read2
    expect(mocks.spawnImpl.mock.calls.length).toBe(1)
  })
})
