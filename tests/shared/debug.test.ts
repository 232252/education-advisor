// =============================================================
// shared/debug.ts 测试 — 环境变量解析、debugPrefix、debugLog、startIpcTimer
// 注意: debug.ts 在 module load 时调用 buildConfig() 快照,
// 所以测试通过 vi.stubEnv + 动态 import + vi.resetModules 重新加载。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('shared/debug', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // 清掉所有 DEBUG_* 环境变量,确保每个 case 都从干净状态开始
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('DEBUG') || k === 'ENABLE_CDP') delete process.env[k]
    }
    vi.resetModules()
  })

  afterEach(() => {
    // 还原环境变量
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('DEBUG') || k === 'ENABLE_CDP') delete process.env[k]
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v
    }
    vi.restoreAllMocks()
  })

  describe('buildConfig', () => {
    it('默认无任何 DEBUG 环境变量时应全部关闭', async () => {
      const { debug } = await import('../../src/shared/debug')
      expect(debug.enabled).toBe(false)
      expect(debug.eaa).toBe(false)
      expect(debug.ipc).toBe(false)
      expect(debug.agent).toBe(false)
      expect(debug.chat).toBe(false)
      expect(debug.cron).toBe(false)
      expect(debug.privacy).toBe(false)
      expect(debug.render).toBe(false)
      expect(debug.logLevel).toBeNull()
      expect(debug.cdpPort).toBe(0)
      expect(debug.slowThresholdMs).toBe(500)
    })

    it('DEBUG=1 应开启全部子项', async () => {
      process.env.DEBUG = '1'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.enabled).toBe(true)
      expect(debug.eaa).toBe(true)
      expect(debug.ipc).toBe(true)
      expect(debug.agent).toBe(true)
      expect(debug.chat).toBe(true)
      expect(debug.cron).toBe(true)
      expect(debug.privacy).toBe(true)
      expect(debug.render).toBe(true)
    })

    it('DEBUG=true 也应开启', async () => {
      process.env.DEBUG = 'true'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.enabled).toBe(true)
    })

    it('DEBUG=yes 也应开启', async () => {
      process.env.DEBUG = 'yes'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.enabled).toBe(true)
    })

    it('DEBUG_EAA=1 单独开启 eaa(并使 masterOn = true)', async () => {
      process.env.DEBUG_EAA = '1'
      const { debug } = await import('../../src/shared/debug')
      // masterOn 为 true 因为 anySubFlag 为 true
      expect(debug.enabled).toBe(true)
      expect(debug.eaa).toBe(true)
      // 但其他子项应为 false (除非 DEBUG 也开启)
      expect(debug.ipc).toBe(false)
      expect(debug.agent).toBe(false)
    })

    it('DEBUG_IPC=1 单独开启 ipc', async () => {
      process.env.DEBUG_IPC = '1'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.ipc).toBe(true)
      expect(debug.eaa).toBe(false)
    })

    it('DEBUG_AGENT / DEBUG_CHAT / DEBUG_CRON / DEBUG_PRIVACY / DEBUG_RENDER 各自独立', async () => {
      process.env.DEBUG_AGENT = '1'
      const d1 = (await import('../../src/shared/debug')).debug
      expect(d1.agent).toBe(true)
      vi.resetModules()
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('DEBUG')) delete process.env[k]
      }

      process.env.DEBUG_CHAT = '1'
      const d2 = (await import('../../src/shared/debug')).debug
      expect(d2.chat).toBe(true)

      vi.resetModules()
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('DEBUG')) delete process.env[k]
      }
      process.env.DEBUG_CRON = '1'
      const d3 = (await import('../../src/shared/debug')).debug
      expect(d3.cron).toBe(true)

      vi.resetModules()
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('DEBUG')) delete process.env[k]
      }
      process.env.DEBUG_PRIVACY = '1'
      const d4 = (await import('../../src/shared/debug')).debug
      expect(d4.privacy).toBe(true)

      vi.resetModules()
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('DEBUG')) delete process.env[k]
      }
      process.env.DEBUG_RENDER = '1'
      const d5 = (await import('../../src/shared/debug')).debug
      expect(d5.render).toBe(true)
    })

    it('DEBUG_LOG_LEVEL 合法值应被接受', async () => {
      for (const lvl of ['debug', 'info', 'warn', 'error', 'off']) {
        vi.resetModules()
        for (const k of Object.keys(process.env)) {
          if (k.startsWith('DEBUG')) delete process.env[k]
        }
        process.env.DEBUG_LOG_LEVEL = lvl
        const { debug } = await import('../../src/shared/debug')
        expect(debug.logLevel).toBe(lvl)
      }
    })

    it('DEBUG_LOG_LEVEL 非法值应回退为 null', async () => {
      process.env.DEBUG_LOG_LEVEL = 'verbose'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.logLevel).toBeNull()
    })

    it('ENABLE_CDP=1 应使 cdpPort = 9222', async () => {
      process.env.ENABLE_CDP = '1'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.cdpPort).toBe(9222)
    })

    it('ENABLE_CDP=0 应使 cdpPort = 0', async () => {
      process.env.ENABLE_CDP = '0'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.cdpPort).toBe(0)
    })

    it('DEBUG_SLOW_THRESHOLD 应解析为整数', async () => {
      process.env.DEBUG_SLOW_THRESHOLD = '1234'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.slowThresholdMs).toBe(1234)
    })

    it('DEBUG_SLOW_THRESHOLD 非数字应回退到 500', async () => {
      process.env.DEBUG_SLOW_THRESHOLD = 'abc'
      const { debug } = await import('../../src/shared/debug')
      expect(debug.slowThresholdMs).toBe(500)
    })
  })

  describe('debugPrefix', () => {
    it('应返回 [debug:scope] 格式', async () => {
      const { debugPrefix } = await import('../../src/shared/debug')
      expect(debugPrefix('eaa')).toBe('[debug:eaa]')
      expect(debugPrefix('ipc')).toBe('[debug:ipc]')
      expect(debugPrefix('agent')).toBe('[debug:agent]')
    })
  })

  describe('debugLog', () => {
    it('当对应开关关闭时应不输出', async () => {
      // 默认所有开关都关闭
      const { debugLog } = await import('../../src/shared/debug')
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      debugLog('eaa', 'should not appear')
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('当对应开关开启时应输出 [debug:scope] msg', async () => {
      process.env.DEBUG_EAA = '1'
      const { debugLog } = await import('../../src/shared/debug')
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      debugLog('eaa', 'execute', { command: 'doctor' })
      expect(spy).toHaveBeenCalledTimes(1)
      const firstCall = spy.mock.calls[0]
      expect(firstCall[0]).toBe('[debug:eaa] execute')
      expect(firstCall[1]).toEqual({ command: 'doctor' })
      spy.mockRestore()
    })

    it('不传 data 时应只输出前缀+msg', async () => {
      process.env.DEBUG_EAA = '1'
      const { debugLog } = await import('../../src/shared/debug')
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      debugLog('eaa', 'no-data')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toBe('[debug:eaa] no-data')
      expect(spy.mock.calls[0].length).toBe(1)
      spy.mockRestore()
    })
  })

  describe('startIpcTimer', () => {
    it('当 ipc 开关关闭时应返回 no-op 函数且不输出', async () => {
      const { startIpcTimer } = await import('../../src/shared/debug')
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const stop = startIpcTimer('eaa:score')
      expect(typeof stop).toBe('function')
      stop()
      // ipc 关闭时不会输出任何东西
      expect(spy).not.toHaveBeenCalled()
      expect(spyWarn).not.toHaveBeenCalled()
      spy.mockRestore()
      spyWarn.mockRestore()
    })

    it('当 ipc 开关开启时,快调用应输出 "channel took Xms"', async () => {
      process.env.DEBUG_IPC = '1'
      const { startIpcTimer, debug } = await import('../../src/shared/debug')
      expect(debug.ipc).toBe(true)
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const stop = startIpcTimer('eaa:score')
      stop()
      expect(spy).toHaveBeenCalledTimes(1)
      const line = spy.mock.calls[0][0] as string
      expect(line).toContain('[debug:ipc]')
      expect(line).toContain('eaa:score')
      expect(line).toContain('took')
      spy.mockRestore()
    })

    it('当 ipc 开关开启时,慢调用(>slowThresholdMs)应 warn', async () => {
      process.env.DEBUG_IPC = '1'
      process.env.DEBUG_SLOW_THRESHOLD = '-1' // 强制所有调用都被视为慢 (elapsed=0 > -1)
      const { startIpcTimer, debug } = await import('../../src/shared/debug')
      expect(debug.slowThresholdMs).toBe(-1)
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const stop = startIpcTimer('eaa:slow')
      stop()
      expect(spy).toHaveBeenCalledTimes(1)
      const line = spy.mock.calls[0][0] as string
      expect(line).toContain('SLOW')
      expect(line).toContain('eaa:slow')
      spy.mockRestore()
    })
  })
})
