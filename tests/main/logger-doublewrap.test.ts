// =============================================================
// Logger — initLogger 双重包裹回归测试 (C.17)
// 验证: 多次调用 initLogger 不会导致日志被重复写入多次
// 此前 bug: 每次 initLogger 用闭包捕获"当前"console 方法,
//          第二次调用时 origInfo = 第一次的 wrapper → 每行写两遍
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `logger-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

// mock electron: logger 模块加载时调用 app.getPath('userData')
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
  },
}))

beforeEach(async () => {
  await fsp.mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  try {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('logger — initLogger 多次调用不重复写', () => {
  it('调用 initLogger 两次后,单条 console.info 只产生一行日志', async () => {
    vi.resetModules()
    const { initLogger } = await import('../../src/main/utils/logger')
    initLogger('info', tmpDir)
    initLogger('info', tmpDir)

    // 清空今天的 main 日志文件
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const logFile = path.join(tmpDir, `main-${today}.log`)
    try {
      fs.writeFileSync(logFile, '')
    } catch {
      /* 可能还没创建 */
    }

    console.info('UNIQUE_MARKER_12345')

    // 等待异步写入完成
    await new Promise((r) => setTimeout(r, 200))

    const content = fs.readFileSync(logFile, 'utf-8')
    const matches = content.match(/UNIQUE_MARKER_12345/g) ?? []
    // 关键断言: 只出现一次(不是两次或更多)
    expect(matches.length).toBe(1)
  })

  it('调用 initLogger 三次后,单条 console.warn 也只产生一行', async () => {
    vi.resetModules()
    const { initLogger } = await import('../../src/main/utils/logger')
    initLogger('debug', tmpDir)
    initLogger('debug', tmpDir)
    initLogger('debug', tmpDir)

    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const logFile = path.join(tmpDir, `main-${today}.log`)
    try {
      fs.writeFileSync(logFile, '')
    } catch {
      /* ignore */
    }

    console.warn('WARN_MARKER_67890')

    await new Promise((r) => setTimeout(r, 200))

    const content = fs.readFileSync(logFile, 'utf-8')
    const matches = content.match(/WARN_MARKER_67890/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('切换 level 后,低于新 level 的日志不写入', async () => {
    vi.resetModules()
    const { initLogger, setLogLevel } = await import('../../src/main/utils/logger')
    initLogger('info', tmpDir)
    setLogLevel('error') // 只写 error

    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const logFile = path.join(tmpDir, `main-${today}.log`)
    try {
      fs.writeFileSync(logFile, '')
    } catch {
      /* ignore */
    }

    console.info('SHOULD_NOT_APPEAR')
    console.error('SHOULD_APPEAR')

    await new Promise((r) => setTimeout(r, 200))

    const content = fs.readFileSync(logFile, 'utf-8')
    expect(content).not.toContain('SHOULD_NOT_APPEAR')
    expect(content).toContain('SHOULD_APPEAR')
  })

  it('off 级别不写任何日志', async () => {
    vi.resetModules()
    const { initLogger } = await import('../../src/main/utils/logger')
    initLogger('off', tmpDir)

    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const logFile = path.join(tmpDir, `main-${today}.log`)
    try {
      fs.writeFileSync(logFile, '')
    } catch {
      /* ignore */
    }

    console.info('a')
    console.warn('b')
    console.error('c')
    console.debug('d')

    await new Promise((r) => setTimeout(r, 200))

    const content = fs.readFileSync(logFile, 'utf-8')
    expect(content).toBe('')
  })
})
