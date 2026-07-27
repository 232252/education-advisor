// =============================================================
// EAA Bridge — 超时后 SIGKILL 升级回归测试
// 修复: 超时后 SIGTERM → 3秒后 SIGKILL 升级,防止子进程成为孤儿
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(
  os.tmpdir(),
  `eaa-kill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')

// 模拟 child process,记录所有 kill 信号
class MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  killSignals: string[] = []
  killed = false

  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }

  kill(signal?: string) {
    if (signal) this.killSignals.push(signal)
    this.killed = true
  }
}

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  spawnImpl: vi.fn(() => new MockChildProcess()),
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    isPackaged: mocks.isPackaged,
  },
}))

vi.mock('cross-spawn', () => ({
  default: mocks.spawnImpl,
  __esModule: true,
}))

// 辅助: 设置 fs.existsSync mock,使 eaa binary 路径被视为存在
function mockExistsSyncForEaaBinary() {
  const origExistsSync = fs.existsSync.bind(fs)
  return vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const ps = typeof p === 'string' ? p : ''
    if (ps.includes('eaa-binaries') || ps.includes('eaa-cli')) return true
    return origExistsSync(p as fs.PathLike)
  })
}

describe('EAA Bridge 超时后 SIGKILL 升级', () => {
  beforeAll(async () => {
    await fsp.mkdir(userDataDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.spawnImpl.mockImplementation(() => new MockChildProcess())
  })

  it('超时后应先发 SIGTERM 再发 SIGKILL', async () => {
    const proc = new MockChildProcess()
    mocks.spawnImpl.mockImplementation(() => proc)
    const existsSpy = mockExistsSyncForEaaBinary()

    const { EAABridge } = await import('../../src/main/services/eaa-bridge')
    const bridge = new EAABridge()

    // 用短超时(50ms)加速测试
    const execPromise = bridge.execute({
      command: 'list',
      args: [],
      timeout: 50,
    })

    // 等待 spawn 完成 + SIGTERM 被发送
    // execute 是 async,内部 await writeQueue 后才 spawn,需要 microtask 等待
    await new Promise((r) => setTimeout(r, 200))

    expect(proc.killSignals).toContain('SIGTERM')

    // 等待 SIGKILL 升级(3 秒后) — 使用真实 timer
    await new Promise((r) => setTimeout(r, 3200))

    expect(proc.killSignals).toContain('SIGKILL')

    // 让进程 close 以 resolve promise
    proc.emit('close', null)
    await execPromise

    existsSpy.mockRestore()
  }, 10_000)

  it('进程正常退出时不应发送任何 kill 信号', async () => {
    const proc = new MockChildProcess()
    mocks.spawnImpl.mockImplementation(() => proc)
    const existsSpy = mockExistsSyncForEaaBinary()

    const { EAABridge } = await import('../../src/main/services/eaa-bridge')
    const bridge = new EAABridge()

    const execPromise = bridge.execute({
      command: 'list',
      args: [],
      timeout: 10_000,
    })

    // 等待 spawn 完成(execute 是 async,内部 await writeQueue)
    await new Promise((r) => setImmediate(r))

    // 现在可以安全地 emit 事件
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ result: 'ok' })))
    proc.emit('close', 0)

    await execPromise

    expect(proc.killSignals.length).toBe(0)
    existsSpy.mockRestore()
  })

  it('stdout 截断时应发送 SIGTERM', async () => {
    const proc = new MockChildProcess()
    mocks.spawnImpl.mockImplementation(() => proc)
    const existsSpy = mockExistsSyncForEaaBinary()

    const { EAABridge } = await import('../../src/main/services/eaa-bridge')
    const bridge = new EAABridge()

    const execPromise = bridge.execute({
      command: 'export',
      args: ['--format', 'csv'],
      timeout: 10_000,
    })

    // 等待 spawn 完成
    await new Promise((r) => setImmediate(r))

    // 发送超过 50MB 的数据触发截断
    const hugeChunk = Buffer.alloc(51 * 1024 * 1024, 0x41)
    proc.stdout.emit('data', hugeChunk)

    // 应已发送 SIGTERM
    expect(proc.killSignals).toContain('SIGTERM')

    // 让进程 close
    proc.emit('close', 1)
    await execPromise

    existsSpy.mockRestore()
  })
})
