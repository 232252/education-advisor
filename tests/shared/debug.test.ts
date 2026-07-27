// =============================================================
// shared/debug.ts 纯函数测试
// 覆盖 buildConfig / readEnvBool / readEnvInt / debugLog / startIpcTimer
// 通过修改 process.env 来验证各开关的组合
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 保留原始 env 快照
const ENV_KEYS = [
  'DEBUG',
  'DEBUG_EAA',
  'DEBUG_IPC',
  'DEBUG_AGENT',
  'DEBUG_CHAT',
  'DEBUG_CRON',
  'DEBUG_PRIVACY',
  'DEBUG_RENDER',
  'DEBUG_LOG_LEVEL',
  'ENABLE_CDP',
  'DEBUG_SLOW_THRESHOLD',
]

function loadDebug() {
  // 每次重新加载模块以重新读取环境变量
  vi.resetModules()
  return import('../../src/shared/debug')
}

function clearDebugEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

describe('debug.ts — buildConfig 环境变量解析', () => {
  const origEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      origEnv[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (origEnv[k] === undefined) delete process.env[k]
      else process.env[k] = origEnv[k]
    }
    vi.restoreAllMocks()
  })

  it('无任何 DEBUG 变量时全部关闭', async () => {
    clearDebugEnv()
    const { debug } = await loadDebug()
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

  it('DEBUG=1 开启全部子开关', async () => {
    clearDebugEnv()
    process.env.DEBUG = '1'
    const { debug } = await loadDebug()
    expect(debug.enabled).toBe(true)
    expect(debug.eaa).toBe(true)
    expect(debug.ipc).toBe(true)
    expect(debug.agent).toBe(true)
    expect(debug.chat).toBe(true)
    expect(debug.cron).toBe(true)
    expect(debug.privacy).toBe(true)
    expect(debug.render).toBe(true)
  })

  it('DEBUG=true / yes 也算开启', async () => {
    for (const v of ['true', 'yes']) {
      clearDebugEnv()
      process.env.DEBUG = v
      const { debug } = await loadDebug()
      expect(debug.enabled).toBe(true)
    }
  })

  it('DEBUG=0 / false / 任意非真值 不开启', async () => {
    for (const v of ['0', 'false', 'no', '', 'random']) {
      clearDebugEnv()
      process.env.DEBUG = v
      const { debug } = await loadDebug()
      expect(debug.enabled).toBe(false)
    }
  })

  it('仅 DEBUG_EAA=1 时 enabled=true, eaa=true, 其余 false', async () => {
    clearDebugEnv()
    process.env.DEBUG_EAA = '1'
    const { debug } = await loadDebug()
    expect(debug.enabled).toBe(true)
    expect(debug.eaa).toBe(true)
    expect(debug.ipc).toBe(false)
    expect(debug.agent).toBe(false)
    expect(debug.chat).toBe(false)
  })

  it('DEBUG=1 + DEBUG_IPC=0 → ipc 仍开启(DEBUG 总开关覆盖)', async () => {
    clearDebugEnv()
    process.env.DEBUG = '1'
    process.env.DEBUG_IPC = '0'
    const { debug } = await loadDebug()
    // masterOn=true, readEnvBool('DEBUG_IPC')=false, 但 || enabled → true
    expect(debug.ipc).toBe(true)
  })

  it('DEBUG_LOG_LEVEL 合法值被接受', async () => {
    for (const lv of ['debug', 'info', 'warn', 'error', 'off']) {
      clearDebugEnv()
      process.env.DEBUG_LOG_LEVEL = lv
      const { debug } = await loadDebug()
      expect(debug.logLevel).toBe(lv)
    }
  })

  it('DEBUG_LOG_LEVEL 非法值 → null', async () => {
    for (const lv of ['trace', 'DEBUG', '', 'verbose', '10']) {
      clearDebugEnv()
      process.env.DEBUG_LOG_LEVEL = lv
      const { debug } = await loadDebug()
      expect(debug.logLevel).toBeNull()
    }
  })

  it('ENABLE_CDP=1 → cdpPort=9222, 否则 0', async () => {
    clearDebugEnv()
    process.env.ENABLE_CDP = '1'
    const { debug } = await loadDebug()
    expect(debug.cdpPort).toBe(9222)

    clearDebugEnv()
    process.env.ENABLE_CDP = '0'
    const { debug: d2 } = await loadDebug()
    expect(d2.cdpPort).toBe(0)
  })

  it('DEBUG_SLOW_THRESHOLD 自定义值生效', async () => {
    clearDebugEnv()
    process.env.DEBUG_SLOW_THRESHOLD = '1200'
    const { debug } = await loadDebug()
    expect(debug.slowThresholdMs).toBe(1200)
  })

  it('DEBUG_SLOW_THRESHOLD 非数字 → 默认 500', async () => {
    clearDebugEnv()
    process.env.DEBUG_SLOW_THRESHOLD = 'abc'
    const { debug } = await loadDebug()
    expect(debug.slowThresholdMs).toBe(500)
  })

  it('DEBUG_SLOW_THRESHOLD 负数: parseInt 得到负值,Number.isFinite 仍接受', async () => {
    // Number.isFinite(-5) === true, 所以负数会被接受
    clearDebugEnv()
    process.env.DEBUG_SLOW_THRESHOLD = '-5'
    const { debug } = await loadDebug()
    expect(debug.slowThresholdMs).toBe(-5)
  })
})

describe('debug.ts — debugLog 条件输出', () => {
  beforeEach(() => {
    delete process.env.DEBUG
    vi.resetModules()
  })
  afterEach(() => vi.restoreAllMocks())

  it('开关关闭时不输出', async () => {
    const { debugLog, debug } = await loadDebug()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('eaa', 'hello')
    expect(spy).not.toHaveBeenCalled()
    void debug
  })

  it('开关开启时输出 [debug:scope] msg', async () => {
    process.env.DEBUG = '1'
    const { debugLog } = await loadDebug()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('eaa', 'hello', { a: 1 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[debug:eaa]')
    expect(spy.mock.calls[0][0]).toContain('hello')
    expect(spy.mock.calls[0][1]).toEqual({ a: 1 })
  })

  it('data 为 undefined 时只输出 msg', async () => {
    process.env.DEBUG = '1'
    const { debugLog } = await loadDebug()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('ipc', 'no-data')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toHaveLength(1)
  })
})

describe('debug.ts — startIpcTimer', () => {
  beforeEach(() => {
    delete process.env.DEBUG
    vi.resetModules()
  })
  afterEach(() => vi.restoreAllMocks())

  it('ipc 关闭时返回 no-op,不输出', async () => {
    const { startIpcTimer } = await loadDebug()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = startIpcTimer('eaa:score')
    stop()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ipc 开启且耗时低于阈值 → console.log', async () => {
    process.env.DEBUG = '1'
    const { startIpcTimer } = await loadDebug()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stop = startIpcTimer('eaa:score')
    stop()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain('eaa:score')
    expect(logSpy.mock.calls[0][0]).toContain('took')
  })

  it('ipc 开启且耗时高于阈值 → console.warn SLOW', async () => {
    process.env.DEBUG = '1'
    process.env.DEBUG_SLOW_THRESHOLD = '-1' // 阈值 -1 → 0ms 也算超时
    const { startIpcTimer } = await loadDebug()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = startIpcTimer('slow:op')
    stop()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('SLOW')
  })
})

describe('debug.ts — debugPrefix', () => {
  it('返回 [debug:scope]', async () => {
    vi.resetModules()
    const { debugPrefix } = await loadDebug()
    expect(debugPrefix('eaa')).toBe('[debug:eaa]')
    expect(debugPrefix('ipc')).toBe('[debug:ipc]')
  })
})
