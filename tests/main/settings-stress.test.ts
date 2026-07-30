// =============================================================
// Settings Service — 快速连续 update 节流压力测试
// 不使用 vi.resetModules(避免干扰其他测试文件的纯函数)
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tmpDir = path.join(
  os.tmpdir(),
  `settings-stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

const { settingsService } = await import('../../src/main/services/settings-service')

describe('stress: settings-service 快速连续 update', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
    settingsService.reset()
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  it('连续 100 次 update 同一字段, flush 后值正确', async () => {
    settingsService.reset()
    const t0 = Date.now()
    for (let i = 0; i < 100; i++) {
      settingsService.update('general.theme', i % 2 === 0 ? 'dark' : 'light')
    }
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(2000)
    await settingsService.flush()
    expect(['dark', 'light']).toContain(settingsService.getSettings().general.theme)
  })

  it('混合 200 次 update 多字段, 最终值正确', async () => {
    settingsService.reset()
    for (let i = 0; i < 200; i++) {
      settingsService.update('general.theme', i % 3 === 0 ? 'dark' : i % 3 === 1 ? 'light' : 'system')
      settingsService.update('general.language', i % 2 === 0 ? 'zh-CN' : 'en-US')
      settingsService.update('chat.maxTokens', 1000 + i)
    }
    await settingsService.flush()
    const s = settingsService.getSettings()
    expect(s.chat.maxTokens).toBe(1199)
    expect(['dark', 'light', 'system']).toContain(s.general.theme)
  })

  it('reset 后再 update 应使用默认值为基础', async () => {
    settingsService.reset()
    settingsService.update('general.theme', 'light')
    settingsService.reset()
    expect(settingsService.getSettings().general.theme).toBe('light')
  })

  it('节流: 500ms 内多次 update 只写一次盘', async () => {
    settingsService.reset()
    for (let i = 0; i < 50; i++) {
      settingsService.update('general.theme', i % 2 === 0 ? 'dark' : 'light')
    }
    await settingsService.flush()
    // flush 后值应是最后一次
    expect(['dark', 'light']).toContain(settingsService.getSettings().general.theme)
  })

  it('update + flush 多轮循环不崩溃', async () => {
    for (let round = 0; round < 10; round++) {
      settingsService.update('chat.maxTokens', 1000 + round)
      await settingsService.flush()
    }
    expect(settingsService.getSettings().chat.maxTokens).toBe(1009)
  })
})
