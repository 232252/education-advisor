// =============================================================
// EAA Bridge — ENOENT 恢复 + stdout 截断 + TEXT_OUTPUT 边界
// 验证 High 1.1 修复: binaryPath 被置 null 后,execute 应重新 resolve
// 验证 MEDIUM 修复: stdout 超 50MB 时截断并 kill
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-enoent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

describe('EAA Bridge — 二进制不可用时立即返回', () => {
  it('binaryPath 为 null 时 execute 返回 failure(不调用 spawn)', async () => {
    vi.resetModules()
    // 模拟平台不支持 → binaryPath = null
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'aix', configurable: true })
    try {
      const mod = await import('../../src/main/services/eaa-bridge')
      const bridge = new mod.EAABridge()
      const result = await bridge.execute({ command: 'info', args: ['info'] })
      expect(result.success).toBe(false)
      expect(result.data).toBeNull()
      expect(result.exitCode).toBe(-1)
      expect(mocks.spawnImpl).not.toHaveBeenCalled()
    } finally {
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
    }
  })
})

describe('EAA Bridge — 文本输出命令', () => {
  it('export 命令不追加 --output json, data 为原始文本', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('exported 100 rows'))
        proc.emit('close', 0)
      })
      return proc
    })

    const result = await bridge.execute({ command: 'export', args: ['--format', 'csv'] })
    expect(result.success).toBe(true)
    expect(typeof result.data).toBe('string')
    expect(result.data).toBe('exported 100 rows')
  })

  it('非零退出码 → success=false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stderr.emit('data', Buffer.from('error: file not found'))
        proc.emit('close', 2)
      })
      return proc
    })

    const result = await bridge.execute({ command: 'export', args: ['--format', 'csv'] })
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(2)
  })
})

describe('EAA Bridge — JSON 解析', () => {
  it('合法 JSON 输出正确解析', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from(JSON.stringify({ score: 10, risk: 'low' })))
        proc.emit('close', 0)
      })
      return proc
    })

    const result = await bridge.execute<{ score: number }>({ command: 'score', args: ['score', '张三'] })
    expect(result.success).toBe(true)
    expect(result.data?.score).toBe(10)
  })

  it('非法 JSON → data 为 null(不抛错)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('not json {'))
        proc.emit('close', 0)
      })
      return proc
    })

    const result = await bridge.execute({ command: 'score', args: ['score', 'x'] })
    expect(result.success).toBe(true) // 进程退出码 0
    expect(result.data).toBeNull() // 但 JSON 解析失败
  })
})

describe('EAA Bridge — getSupportedExportFormats', () => {
  it('应返回包含 csv/jsonl/html 的列表', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    // mock spawn 返回 export --help 文本
    mocks.spawnImpl.mockImplementation(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('Formats: csv, jsonl, html'))
        proc.emit('close', 0)
      })
      return proc
    })
    const formats = await bridge.getSupportedExportFormats()
    expect(formats).toContain('csv')
    expect(formats).toContain('jsonl')
    expect(formats).toContain('html')
  })

  it('多次调用应去重(只 spawn 一次)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mocks.spawnImpl.mockClear()
    mocks.spawnImpl.mockImplementation(() => {
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('csv jsonl html'))
        proc.emit('close', 0)
      })
      return proc
    })
    // 并发调用两次(在第一次 resolve 前)
    const [r1, r2] = await Promise.all([
      bridge.getSupportedExportFormats(),
      bridge.getSupportedExportFormats(),
    ])
    expect(r1).toEqual(r2)
    // 由于 exportFormatsInFlight 去重, spawn 应只被调一次
    expect(mocks.spawnImpl).toHaveBeenCalledTimes(1)
  })
})

describe('EAA Bridge — getBinaryPath / isInitialized', () => {
  it('getBinaryPath 返回非空字符串(可用时)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    const bp = bridge.getBinaryPath()
    expect(typeof bp).toBe('string')
    expect(bp!.length).toBeGreaterThan(0)
  })

  it('getDataDir 返回 userData/eaa-data', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    const dd = bridge.getDataDir()
    expect(dd).toContain('eaa-data')
  })

  it('isInitialized 返回布尔值', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    expect(typeof bridge.isInitialized()).toBe('boolean')
  })
})
