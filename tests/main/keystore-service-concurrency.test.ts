// =============================================================
// Keystore Service 补充测试 — 并发写入 / flush / load 时序
// 覆盖此前未测试的竞态保护(_writing/_needsResave do-while)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `keystore-conc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  encryptionAvailable: true,
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    encryptString: (plain: string) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
    decryptString: (buf: Buffer) => {
      const s = buf.toString()
      return Buffer.from(s.slice(4), 'base64').toString('utf-8')
    },
  },
}))

const { keystoreService } = await import('../../src/main/services/keystore-service')

describe('keystoreService 并发写入', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  it('并发 setApiKey 多个 provider 应全部保留', async () => {
    const providers = ['openai', 'anthropic', 'google', 'deepseek', 'qwen']
    const promises = providers.map((p, i) => keystoreService.setApiKey(p, `key-${i}-secret`))
    await Promise.all(promises)
    await keystoreService.flush()

    for (let i = 0; i < providers.length; i++) {
      expect(keystoreService.getApiKey(providers[i])).toBe(`key-${i}-secret`)
    }
  })

  it('同一 provider 快速连续 setApiKey 应以最后一次为准', async () => {
    for (let i = 0; i < 10; i++) {
      await keystoreService.setApiKey('rapid', `v${i}`)
    }
    await keystoreService.flush()
    expect(keystoreService.getApiKey('rapid')).toBe('v9')
  })

  it('set + delete + set 序列应正确', async () => {
    await keystoreService.setApiKey('sds', 'first')
    await keystoreService.deleteApiKey('sds')
    expect(keystoreService.getApiKey('sds')).toBeUndefined()
    await keystoreService.setApiKey('sds', 'second')
    await keystoreService.flush()
    expect(keystoreService.getApiKey('sds')).toBe('second')
  })

  it('listProviders 不应包含 __secret__ 前缀的密钥', async () => {
    await keystoreService.setSecret('mydata', 'secret-value')
    await keystoreService.flush()
    const providers = keystoreService.listProviders()
    expect(providers).not.toContain('__secret__:mydata')
  })

  it('saveNow 后重新 load 应能读回全部 key', async () => {
    await keystoreService.setApiKey('persist-a', 'val-a')
    await keystoreService.setApiKey('persist-b', 'val-b')
    await keystoreService.flush()

    // 重新 load
    await keystoreService.load()
    expect(keystoreService.getApiKey('persist-a')).toBe('val-a')
    expect(keystoreService.getApiKey('persist-b')).toBe('val-b')
  })

  it('setSecret/getSecret 应使用 __secret__ 前缀隔离', async () => {
    await keystoreService.setSecret('token', 'tok-value')
    await keystoreService.flush()
    expect(keystoreService.getSecret('token')).toBe('tok-value')
    // 不应出现在 listProviders
    expect(keystoreService.listProviders().includes('token')).toBe(false)
  })

  it('delete 不存在的 key 不应抛错(同步)', () => {
    expect(() => keystoreService.deleteApiKey('nonexistent-xyz')).not.toThrow()
  })

  it('isAvailable 应反映 safeStorage 状态', () => {
    expect(keystoreService.isAvailable()).toBe(true)
  })

  it('clearLastError 应清除错误状态', () => {
    keystoreService.clearLastError()
    expect(keystoreService.getLastError()).toBeNull()
  })
})
