// =============================================================
// EAA Bridge — JSON/TEXT 命令分类全覆盖
// 验证: 每个 JSON 命令追加 --output json, 每个 TEXT 命令不追加
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-cmdcls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')

class MockCP extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill() {
    this.killed = true
  }
}

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((n: string) => (n === 'userData' ? userDataDir : '')),
  isPackaged: false,
  spawnImpl: vi.fn(() => new MockCP()),
}))

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: mocks.isPackaged } }))
vi.mock('cross-spawn', () => ({ default: mocks.spawnImpl, __esModule: true }))

function isEaaBin(p: string) {
  return (
    (p.includes('eaa-binaries') && (p.endsWith('eaa.exe') || p.endsWith('eaa'))) ||
    (p.includes('eaa-cli') && (p.endsWith('eaa.exe') || p.endsWith('eaa')))
  )
}

let spy: ReturnType<typeof vi.spyOn> | null = null

beforeAll(async () => {
  await fsp.mkdir(userDataDir, { recursive: true })
  const orig = fs.existsSync.bind(fs)
  spy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const ps = typeof p === 'string' ? p : ''
    return isEaaBin(ps) || orig(p)
  })
})

afterAll(async () => {
  spy?.mockRestore()
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

// 已知的 JSON 兼容命令(应追加 --output json)
const JSON_COMMANDS = [
  'doctor', 'list', 'get', 'query', 'search', 'stats', 'report',
  'find', 'show', 'status', 'history', 'summary', 'ranking',
  'info', 'score', 'validate', 'range', 'tag', 'codes', 'list-students', 'replay',
]

// 已知的文本输出命令(不应追加 --output json)
const TEXT_COMMANDS = [
  'export', 'dashboard', 'serve', 'init', 'config', 'privacy',
  'add', 'revert', 'add-student', 'delete-student', 'set-student-meta', 'import',
]

describe('EAA Bridge — JSON 命令应追加 --output json', () => {
  for (const cmd of JSON_COMMANDS) {
    it(`${cmd} 应追加 --output json`, async () => {
      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      const bridge = new mod.EAABridge()
      let capturedArgs: string[] = []
      mocks.spawnImpl.mockClear()
      mocks.spawnImpl.mockImplementationOnce((_c: string, args: string[]) => {
        capturedArgs = args
        const proc = new MockCP()
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('{}'))
          proc.emit('close', 0)
        })
        return proc
      })
      await bridge.execute({ command: cmd, args: [cmd] })
      expect(capturedArgs).toContain('--output')
      expect(capturedArgs).toContain('json')
    })
  }
})

describe('EAA Bridge — TEXT 命令不应追加 --output json', () => {
  for (const cmd of TEXT_COMMANDS) {
    it(`${cmd} 不应追加 --output json`, async () => {
      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      const bridge = new mod.EAABridge()
      let capturedArgs: string[] = []
      mocks.spawnImpl.mockClear()
      mocks.spawnImpl.mockImplementationOnce((_c: string, args: string[]) => {
        capturedArgs = args
        const proc = new MockCP()
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('text output'))
          proc.emit('close', 0)
        })
        return proc
      })
      await bridge.execute({ command: cmd, args: [cmd] })
      // 不应同时包含 --output 和 json
      const hasOutput = capturedArgs.includes('--output')
      const hasJson = capturedArgs.includes('json')
      expect(hasOutput && hasJson).toBe(false)
    })
  }
})

describe('EAA Bridge — jsonOutput 显式覆盖', () => {
  it('jsonOutput=true 强制追加 --output json(即使 TEXT 命令)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    let capturedArgs: string[] = []
    mocks.spawnImpl.mockClear()
    mocks.spawnImpl.mockImplementationOnce((_c: string, args: string[]) => {
      capturedArgs = args
      const proc = new MockCP()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('{}'))
        proc.emit('close', 0)
      })
      return proc
    })
    await bridge.execute({ command: 'add', args: ['add'], jsonOutput: true })
    expect(capturedArgs).toContain('--output')
    expect(capturedArgs).toContain('json')
  })

  it('jsonOutput=false 强制不追加(即使 JSON 命令)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    let capturedArgs: string[] = []
    mocks.spawnImpl.mockClear()
    mocks.spawnImpl.mockImplementationOnce((_c: string, args: string[]) => {
      capturedArgs = args
      const proc = new MockCP()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('text'))
        proc.emit('close', 0)
      })
      return proc
    })
    await bridge.execute({ command: 'info', args: ['info'], jsonOutput: false })
    const hasOutput = capturedArgs.includes('--output')
    const hasJson = capturedArgs.includes('json')
    expect(hasOutput && hasJson).toBe(false)
  })
})

describe('EAA Bridge — 命令分类一致性', () => {
  it('JSON 和 TEXT 命令集合不重叠', () => {
    const overlap = JSON_COMMANDS.filter((c) => TEXT_COMMANDS.includes(c))
    expect(overlap).toEqual([])
  })

  it('命令总数覆盖了核心功能(>=30)', () => {
    expect(JSON_COMMANDS.length + TEXT_COMMANDS.length).toBeGreaterThanOrEqual(30)
  })
})
