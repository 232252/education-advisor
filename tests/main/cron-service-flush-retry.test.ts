// =============================================================
// Cron Service — flushLogs 失败时日志恢复回归测试
// 修复: 写入失败时日志恢复到 buffer 前部,避免数据丢失
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(
  os.tmpdir(),
  `cron-flush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')

const mocks = vi.hoisted(() => ({
  userDataDirHolder: { value: '' },
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return mocks.userDataDirHolder.value
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    isPackaged: mocks.isPackaged,
  },
  BrowserWindow: class {},
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => ({
      feishu: { bitableSync: { enabled: false } },
      general: { timezone: 'Asia/Shanghai' },
    }),
  },
}))

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getSecret: vi.fn().mockReturnValue('') },
}))

vi.mock('../../src/main/services/feishu-service', () => ({
  syncBitableNow: vi.fn(),
}))

import { cronService } from '../../src/main/services/cron-service'

interface ServiceInternals {
  logBuffer: Array<Record<string, unknown>>
  flushLogs: () => Promise<void>
}

describe('cronService flushLogs 失败时日志恢复', () => {
  beforeAll(async () => {
    mocks.userDataDirHolder.value = userDataDir
    await fsp.mkdir(userDataDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // 清空 buffer
    const svc = cronService as unknown as ServiceInternals
    svc.logBuffer.length = 0
  })

  it('写入失败时日志应恢复到 buffer,不丢失', async () => {
    vi.spyOn(fsp, 'appendFile').mockRejectedValue(new Error('disk full'))

    const svc = cronService as unknown as ServiceInternals
    const entry = { taskId: 'fail-test', status: 'error', timestamp: Date.now() }
    svc.logBuffer.push(entry)

    await cronService.flushLogs()

    // 日志应恢复到 buffer
    expect(svc.logBuffer.length).toBeGreaterThan(0)
    expect(svc.logBuffer[0]).toEqual(entry)
  })

  it('写入成功时 buffer 应被清空', async () => {
    vi.spyOn(fsp, 'appendFile').mockResolvedValue(undefined)

    const svc = cronService as unknown as ServiceInternals
    svc.logBuffer.push({ taskId: 'ok-test', status: 'success', timestamp: Date.now() })

    await cronService.flushLogs()

    expect(svc.logBuffer.length).toBe(0)
  })

  it('连续失败时 buffer 不超过 500 条上限', async () => {
    vi.spyOn(fsp, 'appendFile').mockRejectedValue(new Error('persistent failure'))

    const svc = cronService as unknown as ServiceInternals

    // 模拟大量日志写入失败
    for (let i = 0; i < 600; i++) {
      svc.logBuffer.push({ taskId: `overflow-${i}`, timestamp: Date.now() })
      await cronService.flushLogs()
    }

    expect(svc.logBuffer.length).toBeLessThanOrEqual(500)
  })

  it('失败后恢复写入成功应清空 buffer', async () => {
    const svc = cronService as unknown as ServiceInternals

    // 第一次失败
    vi.spyOn(fsp, 'appendFile').mockRejectedValueOnce(new Error('transient'))
    svc.logBuffer.push({ taskId: 'retry-test', status: 'error', timestamp: Date.now() })
    await cronService.flushLogs()
    expect(svc.logBuffer.length).toBeGreaterThan(0)

    // 第二次成功
    vi.spyOn(fsp, 'appendFile').mockResolvedValueOnce(undefined)
    await cronService.flushLogs()
    expect(svc.logBuffer.length).toBe(0)
  })
})
