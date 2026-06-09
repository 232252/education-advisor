// =============================================================
// Keystore Service — API Key 安全存储
// 技术方向：Electron safeStorage (Windows DPAPI) 加密存储
// 修复：
//   P1-21: save() 改为异步写盘，不阻塞主进程
//   P1-22: 解密失败时记录 lastError，调用方可查询提示用户重新输入
//   P1-23: 启动时改为异步 load，不再阻塞主进程 50-200ms
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'

class KeystoreService {
  private keyStorePath: string
  private cache: Map<string, string> = new Map()
  /** 异步加载完成的 promise，调用方在 getApiKey 前可 await */
  private _ready: Promise<void>
  /** 最近的解密/读写错误 */
  private _lastError: string | null = null
  /** 是否有未完成的写入（用于 graceful shutdown） */
  private _pendingWrites = 0

  constructor() {
    this.keyStorePath = path.join(app.getPath('userData'), 'keystore.enc')
    // 异步启动加载，不阻塞主进程（P1-23）
    this._ready = this.load()
  }

  /** 异步从磁盘加载并解密 */
  private async load(): Promise<void> {
    console.log(`[Keystore] Loading from: ${this.keyStorePath}`)
    try {
      await fsp.access(this.keyStorePath, fs.constants.F_OK)
    } catch {
      // 文件不存在，缓存保持空
      console.log('[Keystore] No keystore file found — starting with empty cache')
      return
    }
    try {
      const encrypted = await fsp.readFile(this.keyStorePath)
      if (!safeStorage.isEncryptionAvailable()) {
        // safeStorage 不可用（Linux 无 keyring 等）——读不到也写不进去
        this._lastError = 'Encryption backend not available on this platform'
        console.warn(`[Keystore] ${this._lastError}`)
        return
      }
      const decrypted = safeStorage.decryptString(encrypted)
      const parsed = JSON.parse(decrypted) as Record<string, string>
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === 'string' && typeof value === 'string') {
            this.cache.set(key, value)
          }
        }
        console.log(`[Keystore] Loaded ${this.cache.size} API key(s) from keystore`)
      }
    } catch (err) {
      // 解密失败（可能换了机器 / 重装系统 / DPAPI key 已失效）
      // 清空缓存，提示用户重新输入（P1-22）
      const msg = err instanceof Error ? err.message : String(err)
      this._lastError = `Keystore decryption failed (${msg}). Please re-enter your API keys.`
      console.warn('[Keystore] Failed to decrypt keystore, clearing cache:', msg)
      this.cache.clear()
    }
  }

  /** 加密后异步保存到磁盘，不阻塞调用方（P1-21） */
  private async save(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      this._lastError = 'Cannot save: encryption backend not available'
      console.warn(`[Keystore] ${this._lastError}`)
      return
    }
    const obj = Object.fromEntries(this.cache)
    const json = JSON.stringify(obj)
    const encrypted = safeStorage.encryptString(json)
    this._pendingWrites++
    try {
      // 原子写入：先写临时文件再 rename，避免崩溃导致 keystore.enc 损坏
      const tmpPath = `${this.keyStorePath}.tmp`
      await fsp.writeFile(tmpPath, encrypted)
      await fsp.rename(tmpPath, this.keyStorePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._lastError = `Failed to save keystore: ${msg}`
      console.error('[Keystore] Save failed:', msg)
    } finally {
      this._pendingWrites--
    }
  }

  /**
   * 等待初始加载完成。在调用 getApiKey 前可 await 此方法以保证拿到最新数据。
   */
  async ready(): Promise<void> {
    return this._ready
  }

  /** 获取最近一次错误信息（启动解密失败 / 平台不支持 / 写盘失败） */
  getLastError(): string | null {
    return this._lastError
  }

  /** 清除最近一次错误（用户重新输入 key 后可调用） */
  clearLastError(): void {
    this._lastError = null
  }

  getApiKey(provider: string): string | undefined {
    return this.cache.get(provider)
  }

  /**
   * 设置 API key。setApiKey 是同步返回（写入磁盘是异步 fire-and-forget），
   * 这样调用方不用 await，但数据丢失风险已被原子 rename 缓解。
   */
  setApiKey(provider: string, apiKey: string): void {
    if (typeof provider !== 'string' || provider.length === 0) {
      throw new Error('provider must be a non-empty string')
    }
    if (typeof apiKey !== 'string') {
      throw new Error('apiKey must be a string')
    }
    this.cache.set(provider, apiKey)
    this._lastError = null
    // fire-and-forget：失败时只记录，不阻塞
    void this.save()
  }

  deleteApiKey(provider: string): void {
    this.cache.delete(provider)
    void this.save()
  }

  /** 列出已保存的 provider 名称（不含 key 内容，排除内部 secret） */
  listProviders(): string[] {
    return Array.from(this.cache.keys()).filter((k) => !k.startsWith('__secret__:'))
  }

  /** 获取通用密钥（非 API key 的敏感信息，如飞书 appSecret） */
  getSecret(key: string): string | undefined {
    return this.cache.get(`__secret__:${key}`)
  }

  /** 设置通用密钥 */
  setSecret(key: string, value: string): void {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('key must be a non-empty string')
    }
    this.cache.set(`__secret__:${key}`, value)
    this._lastError = null
    void this.save()
  }

  /** 删除通用密钥 */
  deleteSecret(key: string): void {
    this.cache.delete(`__secret__:${key}`)
    void this.save()
  }

  /** 检查 DPAPI / 平台安全存储是否可用 */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** 优雅关闭：等待所有待写入完成 */
  async flush(): Promise<void> {
    while (this._pendingWrites > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

export const keystoreService = new KeystoreService()
