// =============================================================
// EAA Bridge — execute 结果结构完整性测试
// 验证: EAAResult 的所有字段(success/data/stderr/exitCode)在各种场景下正确
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function mockSpawn(stdoutData: string, stderrData = '', exitCode = 0) {
  mocks.spawnImpl.mockImplementationOnce(() => {
    const proc = new MockCP()
    setImmediate(() => {
      if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData))
      if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData))
      proc.emit('close', exitCode)
    })
    return proc
  })
}

describe('EAAResult 结构 — 成功路径', () => {
  it('exit 0 + JSON 输出 → success=true, data=parsed, exitCode=0', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn(JSON.stringify({ students: [{ name: '张三' }] }))
    const r = await bridge.execute({ command: 'list-students', args: ['list-students'] })
    expect(r.success).toBe(true)
    expect(r.exitCode).toBe(0)
    expect(r.data).toEqual({ students: [{ name: '张三' }] })
    expect(typeof r.stderr).toBe('string')
  })

  it('exit 0 + 文本输出 → success=true, data=string', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn('exported 100 rows')
    const r = await bridge.execute({ command: 'export', args: ['--format', 'csv'] })
    expect(r.success).toBe(true)
    expect(typeof r.data).toBe('string')
    expect(r.data).toBe('exported 100 rows')
  })

  it('exit 0 + 空 stdout + stderr → data 取 stderr', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn('', 'warning message', 0)
    const r = await bridge.execute({ command: 'add', args: ['add'] })
    expect(r.success).toBe(true)
    // data 应为 stderr(因 stdout 为空)
    expect(r.data).toBe('warning message')
  })
})

describe('EAAResult 结构 — 失败路径', () => {
  it('exit != 0 → success=false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn('', 'fatal error', 1)
    const r = await bridge.execute({ command: 'add', args: ['add'] })
    expect(r.success).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('fatal error')
  })

  it('exit 2 → success=false, exitCode=2', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn('error output', '', 2)
    const r = await bridge.execute({ command: 'export', args: ['--format', 'csv'] })
    expect(r.success).toBe(false)
    expect(r.exitCode).toBe(2)
  })

  it('JSON 解析失败 → data=null, success=true(进程成功但 JSON 无效)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mockSpawn('not valid json {{{')
    const r = await bridge.execute({ command: 'info', args: ['info'] })
    expect(r.success).toBe(true)
    expect(r.data).toBeNull()
  })
})

describe('EAAResult 结构 — spawn error', () => {
  it('spawn ENOENT → success=false, exitCode=-1', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = new MockCP()
      setImmediate(() => {
        const err = new Error('ENOENT') as Error & { code: string }
        err.code = 'ENOENT'
        proc.emit('error', err)
      })
      return proc
    })
    const r = await bridge.execute({ command: 'info', args: ['info'] })
    expect(r.success).toBe(false)
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toContain('ENOENT')
    expect(r.data).toBeNull()
  })
})

describe('getErrorMessage — 优先级', () => {
  it('data(string) > stderr > fallback', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    expect(mod.getErrorMessage({ success: false, data: 'data err', stderr: 'stderr', exitCode: 1 })).toBe('data err')
    expect(mod.getErrorMessage({ success: false, data: '', stderr: 'stderr', exitCode: 1 })).toBe('stderr')
    expect(mod.getErrorMessage({ success: false, data: null, stderr: '', exitCode: 1 }, 'fb')).toBe('fb')
    expect(mod.getErrorMessage({ success: false, data: 42, stderr: 's', exitCode: 1 })).toBe('s')
    expect(mod.getErrorMessage({ success: false, data: { x: 1 }, stderr: '', exitCode: 1 }, 'fb')).toBe('fb')
  })
})

describe('SUPPORTED_EXPORT_FORMATS', () => {
  it('应等于 [csv, jsonl, html]', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    expect(mod.SUPPORTED_EXPORT_FORMATS).toEqual(['csv', 'jsonl', 'html'])
  })

  it('应是 readonly 元组(类型安全)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    expect(mod.SUPPORTED_EXPORT_FORMATS.length).toBe(3)
    expect(Array.isArray(mod.SUPPORTED_EXPORT_FORMATS)).toBe(true)
  })
})
