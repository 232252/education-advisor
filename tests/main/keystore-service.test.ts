// =============================================================
// Keystore Service 测试 — 加密、原子写入、错误处理
// 覆盖：保存/读取 API Key、setSecret/getSecret、原子 rename、错误路径
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpBase = os.tmpdir()
const tmpDir = path.join(
  tmpBase,
  `keystore-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  // safeStorage mock — 用 base64 模拟加密/解密（实际环境用 DPAPI）
  encrypted: new Map<string, string>(),
  encryptionAvailable: true,
}))

vi.mock('electron', () => {
  return {
    app: {
      getPath: mocks.getPath,
    },
    safeStorage: {
      isEncryptionAvailable: () => mocks.encryptionAvailable,
      encryptString: (plain: string) => {
        if (!mocks.encryptionAvailable) throw new Error('Encryption backend not available')
        const enc = Buffer.from(plain).toString('base64')
        return Buffer.from(`enc:${enc}`)
      },
      decryptString: (buf: Buffer) => {
        const s = buf.toString()
        if (!s.startsWith('enc:')) throw new Error('Decryption failed: bad format')
        return Buffer.from(s.slice(4), 'base64').toString('utf-8')
      },
    },
  }
})

// 动态 import 在 mock 之后
const { keystoreService } = await import('../../src/main/services/keystore-service')

describe('keystoreService', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    // 清理 tmpDir 中的 keystore.enc
    try {
      await fsp.unlink(path.join(tmpDir, 'keystore.enc'))
    } catch {
      /* ignore */
    }
    try {
      await fsp.unlink(path.join(tmpDir, 'keystore.enc.tmp'))
    } catch {
      /* ignore */
    }
  })

  it('getApiKey 在空 keystore 中应返回 undefined', async () => {
    await keystoreService.ready()
    expect(keystoreService.getApiKey('openai')).toBeUndefined()
  })

  it('setApiKey + getApiKey 应往返一致', async () => {
    await keystoreService.ready()
    keystoreService.setApiKey('openai', 'sk-test-123')
    // 写盘是异步的，等一下
    await keystoreService.flush()
    expect(keystoreService.getApiKey('openai')).toBe('sk-test-123')
  })

  it('deleteApiKey 应移除键', async () => {
    await keystoreService.ready()
    keystoreService.setApiKey('anthropic', 'sk-ant-456')
    await keystoreService.flush()
    expect(keystoreService.getApiKey('anthropic')).toBe('sk-ant-456')
    keystoreService.deleteApiKey('anthropic')
    await keystoreService.flush()
    expect(keystoreService.getApiKey('anthropic')).toBeUndefined()
  })

  it('listProviders 不应包含 __secret__: 前缀的密钥', async () => {
    await keystoreService.ready()
    keystoreService.setApiKey('openai', 'sk-test-1')
    keystoreService.setSecret('feishu-app-secret', 'secret-123')
    await keystoreService.flush()
    const list = keystoreService.listProviders()
    expect(list).toContain('openai')
    expect(list).not.toContain('__secret__:feishu-app-secret')
  })

  it('setSecret/getSecret 应使用 __secret__: 前缀', async () => {
    await keystoreService.ready()
    keystoreService.setSecret('feishu-app-secret', 'secret-abc')
    await keystoreService.flush()
    expect(keystoreService.getSecret('feishu-app-secret')).toBe('secret-abc')
    keystoreService.deleteSecret('feishu-app-secret')
    await keystoreService.flush()
    expect(keystoreService.getSecret('feishu-app-secret')).toBeUndefined()
  })

  it('加密不可用时 save 应静默失败并设置 lastError', async () => {
    // 重置 keystore（每次 setApiKey 会保存）
    await keystoreService.ready()
    mocks.encryptionAvailable = false
    keystoreService.setApiKey('broken', 'key')
    await keystoreService.flush()
    expect(keystoreService.getLastError()).toMatch(/encryption|Cannot|backend/i)
    // 此时 getApiKey 仍能拿到内存中的值（写入失败但内存未变）
    expect(keystoreService.getApiKey('broken')).toBe('key')
    mocks.encryptionAvailable = true
  })

  it('isAvailable 应返回 true（mock 的 safeStorage 可用）', () => {
    expect(keystoreService.isAvailable()).toBe(true)
  })

  it('原子写入：tmp 文件 + rename', async () => {
    await keystoreService.ready()
    keystoreService.setApiKey('atomic', 'value')
    await keystoreService.flush()
    // 验证 .tmp 不残留
    expect(fs.existsSync(path.join(tmpDir, 'keystore.enc.tmp'))).toBe(false)
    // 验证正式文件存在
    expect(fs.existsSync(path.join(tmpDir, 'keystore.enc'))).toBe(true)
  })

  it('空 provider 应抛错', () => {
    expect(() => keystoreService.setApiKey('', 'key')).toThrow('non-empty')
  })

  it('空 key 类型应抛错', () => {
    expect(() => keystoreService.setApiKey('provider', undefined as unknown as string)).toThrow(
      'string',
    )
  })

  it('clearLastError 应清除 lastError', async () => {
    await keystoreService.ready()
    mocks.encryptionAvailable = false
    keystoreService.setApiKey('provider-x', 'val')
    await keystoreService.flush()
    expect(keystoreService.getLastError()).toBeTruthy()
    keystoreService.clearLastError()
    expect(keystoreService.getLastError()).toBeNull()
    mocks.encryptionAvailable = true
  })
})
