// =============================================================
// EAA Bridge 测试 — 二进制路径解析、命令执行、JSON 解析、降级、初始化
// 通过 mock cross-spawn 模拟 EAA 二进制返回,无需真实二进制
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(
  os.tmpdir(),
  `eaa-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')

// 模拟一个 child process (EventEmitter + stdout/stderr streams)
class MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
  emitData(stream: 'stdout' | 'stderr', chunk: string) {
    this[stream].emit('data', Buffer.from(chunk))
  }
  emitClose(code: number) {
    this.emit('close', code)
  }
  emitError(err: Error) {
    this.emit('error', err)
  }
}

// 默认 spawn mock: 创建一个空的 MockChildProcess(不触发任何事件)
const defaultSpawnImpl = vi.fn((_cmd: string, _args: string[]) => new MockChildProcess())

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  spawnImpl: vi.fn((_cmd: string, _args: string[], _options?: unknown) => new MockChildProcess()),
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

// 辅助: 判断路径是否像 eaa 二进制路径(用于 mock fs.existsSync)
function isEaaBinaryPath(p: string): boolean {
  // resourcePath = .../resources/eaa-binaries/<platform>/eaa.exe
  // fallbackPath = .../education-advisor/core/eaa-cli/target/release/eaa(.exe)
  return (
    (p.includes('eaa-binaries') && (p.endsWith('eaa.exe') || p.endsWith('eaa'))) ||
    (p.includes('eaa-cli') && (p.endsWith('eaa.exe') || p.endsWith('eaa')))
  )
}

// 辅助: 设置 fs.existsSync mock,使 eaa binary 路径被视为存在
function mockExistsSyncForEaaBinary() {
  const origExistsSync = fs.existsSync.bind(fs)
  return vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const ps = typeof p === 'string' ? p : ''
    if (isEaaBinaryPath(ps)) return true
    return origExistsSync(p)
  })
}

describe('EAA Bridge', () => {
  beforeAll(async () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 spawnImpl 到默认实现
    mocks.spawnImpl.mockImplementation(
      (_cmd: string, _args: string[], _options?: unknown) => new MockChildProcess(),
    )
  })

  describe('常量与导出', () => {
    it('SUPPORTED_EXPORT_FORMATS 应包含 csv/jsonl/html (与 Rust cmd_export 同步)', async () => {
      const mod = await import('../../src/main/services/eaa-bridge')
      // Rust 源码 core/eaa-cli/src/commands.rs 的 cmd_export 仅支持 csv/jsonl/html
      expect(mod.SUPPORTED_EXPORT_FORMATS).toEqual(['csv', 'jsonl', 'html'])
    })

    it('getSupportedExportFormats 二进制不可用时应降级到静态列表', async () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'aix', configurable: true })
      try {
        vi.resetModules()
        const mod = await import('../../src/main/services/eaa-bridge')
        const bridge = new mod.EAABridge()
        const formats = await bridge.getSupportedExportFormats()
        expect(formats).toEqual(['csv', 'jsonl', 'html'])
      } finally {
        if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
      }
    })

    it('EAABridge 类应可被实例化', async () => {
      const mod = await import('../../src/main/services/eaa-bridge')
      expect(typeof mod.EAABridge).toBe('function')
      const b = new mod.EAABridge()
      expect(b).toBeInstanceOf(mod.EAABridge)
    })

    it('getErrorMessage 应优先用 data(string)', async () => {
      const mod = await import('../../src/main/services/eaa-bridge')
      expect(
        mod.getErrorMessage({
          success: false,
          data: 'data error',
          stderr: 'stderr error',
          exitCode: 1,
        }),
      ).toBe('data error')
    })

    it('getErrorMessage 应回退到 stderr', async () => {
      const mod = await import('../../src/main/services/eaa-bridge')
      expect(
        mod.getErrorMessage({
          success: false,
          data: '',
          stderr: 'stderr error',
          exitCode: 1,
        }),
      ).toBe('stderr error')
    })

    it('getErrorMessage 应回退到 fallback', async () => {
      const mod = await import('../../src/main/services/eaa-bridge')
      expect(
        mod.getErrorMessage(
          { success: false, data: null, stderr: '', exitCode: 1 },
          'default msg',
        ),
      ).toBe('default msg')
    })
  })

  describe('构造与二进制路径解析', () => {
    it('平台不支持时应记录 unavailableReason', async () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'aix', configurable: true })

      try {
        vi.resetModules()
        const mod = await import('../../src/main/services/eaa-bridge')
        const bridge = new mod.EAABridge()
        expect(bridge.isAvailable()).toBe(false)
        expect(bridge.getUnavailableReason()).toContain('not available for platform')
      } finally {
        if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
      }
    })

    it('dataDir 应位于 userData/eaa-data', async () => {
      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      const bridge = new mod.EAABridge()
      expect(bridge.getDataDir()).toBe(path.join(userDataDir, 'eaa-data'))
    })
  })

  describe('execute — 二进制不可用时降级', () => {
    it('binaryPath 为 null 时 execute 应立即返回失败', async () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'aix', configurable: true })

      try {
        vi.resetModules()
        const mod = await import('../../src/main/services/eaa-bridge')
        const bridge = new mod.EAABridge()
        const result = await bridge.execute({ command: 'doctor', args: [] })
        expect(result.success).toBe(false)
        expect(result.data).toBeNull()
        expect(result.exitCode).toBe(-1)
        expect(result.stderr).toContain('not available')
        expect(mocks.spawnImpl).not.toHaveBeenCalled()
      } finally {
        if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
      }
    })
  })

  describe('execute — 二进制可用时', () => {
    let bridge: InstanceType<
      typeof import('../../src/main/services/eaa-bridge').EAABridge
    >

    beforeEach(async () => {
      vi.restoreAllMocks()
      mockExistsSyncForEaaBinary()
      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      bridge = new mod.EAABridge()
      // 确认 mock 生效: bridge 应可用
      expect(bridge.isAvailable()).toBe(true)
    })

    it('JSON 兼容命令应追加 --output json 并解析 stdout 为 JSON', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', '{"ok":true,"items":[1,2,3]}')
          proc.emitClose(0)
        })
        return proc
      })

      const result = await bridge.execute<{ ok: boolean; items: number[] }>({
        command: 'doctor',
        args: [],
      })
      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.data).toEqual({ ok: true, items: [1, 2, 3] })

      // 验证 spawn 调用参数: doctor --output json
      const spawnCall = mocks.spawnImpl.mock.calls[0]
      expect(spawnCall[0]).toBeTruthy() // binary path
      expect(spawnCall[1]).toEqual(['doctor', '--output', 'json'])
    })

    it('exitCode != 0 时 success 应为 false', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stderr', 'some error')
          proc.emitClose(2)
        })
        return proc
      })

      const result = await bridge.execute({ command: 'doctor', args: [] })
      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('some error')
    })

    it('JSON 解析失败时 data 应为 null', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', 'not valid json {')
          proc.emitClose(0)
        })
        return proc
      })

      const result = await bridge.execute({ command: 'doctor', args: [] })
      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    it('TEXT_OUTPUT_COMMANDS (如 export) 不应追加 --output json', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', 'exported 100 rows to /tmp/out.csv')
          proc.emitClose(0)
        })
        return proc
      })

      const result = await bridge.execute<{ exported: number }>({
        command: 'export',
        args: ['--format', 'csv'],
      })
      expect(result.success).toBe(true)
      expect(result.data).toBe('exported 100 rows to /tmp/out.csv')

      const spawnCall = mocks.spawnImpl.mock.calls[0]
      expect(spawnCall[1]).toEqual(['export', '--format', 'csv'])
      expect(spawnCall[1]).not.toContain('--output')
    })

    it('显式 jsonOutput=true 应强制追加 --output json', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', '{"forced":true}')
          proc.emitClose(0)
        })
        return proc
      })

      const result = await bridge.execute<{ forced: boolean }>({
        command: 'export',
        args: [],
        jsonOutput: true,
      })
      expect(result.data).toEqual({ forced: true })
      const spawnCall = mocks.spawnImpl.mock.calls[0]
      expect(spawnCall[1]).toEqual(['export', '--output', 'json'])
    })

    it('显式 jsonOutput=false 应强制不追加 --output json', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', 'plain text')
          proc.emitClose(0)
        })
        return proc
      })

      const result = await bridge.execute({ command: 'doctor', args: [], jsonOutput: false })
      expect(result.data).toBe('plain text')
      const spawnCall = mocks.spawnImpl.mock.calls[0]
      expect(spawnCall[1]).toEqual(['doctor'])
    })

    it('spawn error (ENOENT) 应清空 binaryPath 并下次返回 unavailable', async () => {
      expect(bridge.isAvailable()).toBe(true)

      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          const err = new Error('ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          proc.emitError(err)
        })
        return proc
      })

      const result = await bridge.execute({ command: 'doctor', args: [] })
      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(-1)
      expect(result.stderr).toContain('ENOENT')

      // ENOENT 后 binaryPath 应被清空
      expect(bridge.isAvailable()).toBe(false)
      expect(bridge.getUnavailableReason()).toContain('disappeared')
    })

    it('未知命令默认追加 --output json', async () => {
      mocks.spawnImpl.mockImplementationOnce(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', '{"unknown":true}')
          proc.emitClose(0)
        })
        return proc
      })

      await bridge.execute({ command: 'unknown-cmd', args: ['--foo'] })
      const spawnCall = mocks.spawnImpl.mock.calls[0]
      expect(spawnCall[1]).toEqual(['unknown-cmd', '--foo', '--output', 'json'])
    })

    it('privacyPassword 设置后应通过环境变量传递', async () => {
      let observedEnv: Record<string, string> | undefined

      mocks.spawnImpl.mockImplementationOnce(
        (_cmd: string, _args: string[], options?: { env?: Record<string, string> }) => {
          observedEnv = options?.env
          const proc = new MockChildProcess()
          setImmediate(() => {
            proc.emitData('stdout', '{"ok":true}')
            proc.emitClose(0)
          })
          return proc
        },
      )

      bridge.setPrivacyPassword('super-secret')
      expect(bridge.hasPrivacyPassword()).toBe(true)

      await bridge.execute({ command: 'doctor', args: [] })
      expect(observedEnv).toBeDefined()
      expect(observedEnv!.EAA_PRIVACY_PASSWORD).toBe('super-secret')
      expect(observedEnv!.EAA_DATA_DIR).toBeTruthy()

      bridge.clearPrivacyPassword()
      expect(bridge.hasPrivacyPassword()).toBe(false)
    })

    it('hasPrivacyPassword 应要求至少 4 个字符', async () => {
      bridge.setPrivacyPassword('abc') // 3 chars
      expect(bridge.hasPrivacyPassword()).toBe(false)
      bridge.setPrivacyPassword('abcd') // 4 chars
      expect(bridge.hasPrivacyPassword()).toBe(true)
    })
  })

  describe('initialize — 数据目录初始化', () => {
    it('应创建 entities/events/logs 子目录和核心 JSON 文件', async () => {
      vi.restoreAllMocks()
      mockExistsSyncForEaaBinary()

      // 用一个全新的 userData 目录
      const freshUserData = path.join(tmpRoot, 'fresh-userdata')
      await fsp.mkdir(freshUserData, { recursive: true })
      mocks.getPath.mockImplementation((name: string) => {
        if (name === 'userData') return freshUserData
        throw new Error(`unexpected: ${name}`)
      })

      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')

      // 让 spawn 不被调用,doctor 直接走 catch 分支(不阻塞 initialize)
      mocks.spawnImpl.mockImplementation(() => {
        const proc = new MockChildProcess()
        setImmediate(() => proc.emitClose(0))
        return proc
      })

      const b = new mod.EAABridge()
      const result = await b.initialize()
      expect(b.isInitialized()).toBe(true)

      const dataDir = path.join(freshUserData, 'eaa-data')
      expect(fs.existsSync(path.join(dataDir, 'entities'))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'events'))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'logs'))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'entities', 'entities.json'))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'events', 'events.json'))).toBe(true)
      expect(fs.existsSync(path.join(dataDir, 'entities', 'name_index.json'))).toBe(true)

      // entities.json 内容应是有效 JSON
      const entities = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'entities', 'entities.json'), 'utf-8'),
      )
      expect(entities.version).toBe('1.0')
      expect(entities.base_score).toBe(100.0)
      expect(entities.entities).toEqual({})

      // 重复 initialize 不应覆盖已有文件
      const before = fs.statSync(path.join(dataDir, 'entities', 'entities.json')).mtimeMs
      await new Promise((r) => setTimeout(r, 20))
      await b.initialize()
      const after = fs.statSync(path.join(dataDir, 'entities', 'entities.json')).mtimeMs
      expect(after).toBe(before)
    })

    it('二进制不可用时 initialize 应返回 healthy=false 但仍标记 initialized', async () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'aix', configurable: true })

      try {
        vi.resetModules()
        const mod = await import('../../src/main/services/eaa-bridge')
        const b = new mod.EAABridge()
        const result = await b.initialize()
        expect(result.healthy).toBe(false)
        expect(result.message).toBeTruthy()
        expect(b.isInitialized()).toBe(true)
      } finally {
        if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
      }
    })

    it('doctor 成功时应返回 healthy=true', async () => {
      vi.restoreAllMocks()
      mockExistsSyncForEaaBinary()

      const freshUserData = path.join(tmpRoot, 'fresh-healthy')
      await fsp.mkdir(freshUserData, { recursive: true })
      mocks.getPath.mockImplementation((name: string) => {
        if (name === 'userData') return freshUserData
        throw new Error(`unexpected: ${name}`)
      })

      mocks.spawnImpl.mockImplementation(() => {
        const proc = new MockChildProcess()
        setImmediate(() => {
          proc.emitData('stdout', '{"status":"ok"}')
          proc.emitClose(0)
        })
        return proc
      })

      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      const b = new mod.EAABridge()
      const result = await b.initialize()
      expect(result.healthy).toBe(true)
    })
  })

  describe('getBinaryPath / isInitialized', () => {
    it('getBinaryPath 应返回非空字符串(可用时)', async () => {
      vi.restoreAllMocks()
      mockExistsSyncForEaaBinary()
      vi.resetModules()
      const mod = await import('../../src/main/services/eaa-bridge')
      const b = new mod.EAABridge()
      expect(b.getBinaryPath()).toBeTruthy()
      expect(b.isInitialized()).toBe(false) // 未调用 initialize
    })
  })
})
