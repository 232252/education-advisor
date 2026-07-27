// =============================================================
// EAA Bridge — 隐私密码 + 环境变量传递 测试
// 验证: setPrivacyPassword/clearPrivacyPassword/hasPrivacyPassword
//       密码通过 EAA_PRIVACY_PASSWORD 环境变量传递给子进程
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-priv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')

class MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  killed = false
  actualEnv?: Record<string, string>
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
  kill() {
    this.killed = true
  }
}

const capturedEnv: Record<string, string>[] = []
const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  spawnImpl: vi.fn((_cmd: string, _args: string[], options?: unknown) => new MockChildProcess()),
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

describe('EAA Bridge — 隐私密码 API', () => {
  it('初始状态 hasPrivacyPassword 为 false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    expect(bridge.hasPrivacyPassword()).toBe(false)
  })

  it('setPrivacyPassword 后 hasPrivacyPassword 为 true(>=4字符)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('mypassword123')
    expect(bridge.hasPrivacyPassword()).toBe(true)
  })

  it('密码 < 4 字符时 hasPrivacyPassword 为 false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('abc')
    expect(bridge.hasPrivacyPassword()).toBe(false)
  })

  it('恰好 4 字符时 hasPrivacyPassword 为 true(边界)', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('abcd')
    expect(bridge.hasPrivacyPassword()).toBe(true)
  })

  it('clearPrivacyPassword 后 hasPrivacyPassword 为 false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('password')
    expect(bridge.hasPrivacyPassword()).toBe(true)
    bridge.clearPrivacyPassword()
    expect(bridge.hasPrivacyPassword()).toBe(false)
  })

  it('空字符串密码 hasPrivacyPassword 为 false', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('')
    expect(bridge.hasPrivacyPassword()).toBe(false)
  })
})

describe('EAA Bridge — 密码通过环境变量传递', () => {
  it('设置密码后 execute 应将密码放入 EAA_PRIVACY_PASSWORD 环境变量', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('secret-pwd-999')

    let capturedOptions: Record<string, unknown> | undefined
    mocks.spawnImpl.mockImplementationOnce((_cmd: string, _args: string[], options?: unknown) => {
      capturedOptions = options as Record<string, unknown>
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })
      return proc
    })

    await bridge.execute({ command: 'info', args: ['info'] })

    const env = (capturedOptions as { env?: Record<string, string> })?.env
    expect(env).toBeDefined()
    expect(env?.EAA_PRIVACY_PASSWORD).toBe('secret-pwd-999')
  })

  it('未设置密码时环境变量不含 EAA_PRIVACY_PASSWORD', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    let capturedOptions: Record<string, unknown> | undefined
    mocks.spawnImpl.mockImplementationOnce((_cmd: string, _args: string[], options?: unknown) => {
      capturedOptions = options as Record<string, unknown>
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })
      return proc
    })

    await bridge.execute({ command: 'info', args: ['info'] })

    const env = (capturedOptions as { env?: Record<string, string> })?.env
    expect(env?.EAA_PRIVACY_PASSWORD).toBeUndefined()
  })

  it('clearPassword 后 execute 不再传密码', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()
    bridge.setPrivacyPassword('temp-pwd')
    bridge.clearPrivacyPassword()

    let capturedOptions: Record<string, unknown> | undefined
    mocks.spawnImpl.mockImplementationOnce((_cmd: string, _args: string[], options?: unknown) => {
      capturedOptions = options as Record<string, unknown>
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })
      return proc
    })

    await bridge.execute({ command: 'info', args: ['info'] })
    const env = (capturedOptions as { env?: Record<string, string> })?.env
    expect(env?.EAA_PRIVACY_PASSWORD).toBeUndefined()
  })

  it('环境变量应包含 EAA_DATA_DIR', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const bridge = new mod.EAABridge()

    let capturedOptions: Record<string, unknown> | undefined
    mocks.spawnImpl.mockImplementationOnce((_cmd: string, _args: string[], options?: unknown) => {
      capturedOptions = options as Record<string, unknown>
      const proc = new MockChildProcess()
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })
      return proc
    })

    await bridge.execute({ command: 'info', args: ['info'] })
    const env = (capturedOptions as { env?: Record<string, string> })?.env
    expect(env?.EAA_DATA_DIR).toContain('eaa-data')
  })
})
