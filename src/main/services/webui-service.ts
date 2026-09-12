// =============================================================
// WebUI 服务 — HTTP/HTTPS，绑定范围 loopback / lan / all
// 模式: off 关闭 / always 长开 / scheduled 定时开
// 访问令牌持久化到 keystore（256-bit，不自动轮换）
// =============================================================

import path from 'node:path'
import type { WebUiBind, WebUiMode, WebUiProtocol, WebUiStatus } from '@shared/types'
import { app } from 'electron'
import { errText } from '../utils/err-text'
import { log } from '../utils/logger'
import { openExternalUrl } from '../utils/open-external'
import { keystoreService } from './keystore-service'
import { resolveAppDataDir } from './paths'
import { settingsService } from './settings-service'
import { type GatewayHandle, startWebUiGateway } from './webui/gateway'
import { shouldWebUiListen } from './webui/schedule'
import {
  generateAccessToken,
  isUsableAccessToken,
  LEGACY_CF_TUNNEL_SECRET_KEY,
  listenHost,
  tokenBits,
  WEBUI_ACCESS_TOKEN_KEY,
} from './webui/security'
import { ensureWebUiTls, listDirectAccess, listListenUrls, loadTlsFromFiles } from './webui/tls'

const DEFAULT_PORT = 18765
const TICK_MS = 15_000

function clampPort(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return DEFAULT_PORT
  return n
}

function asProtocol(value: unknown): WebUiProtocol {
  return value === 'http' ? 'http' : 'https'
}

function asBind(value: unknown): WebUiBind {
  if (value === 'loopback' || value === 'all') return value
  return 'lan'
}

class WebUiService {
  private handle: GatewayHandle | null = null
  private token = ''
  private fingerprint: string | null = null
  private usingCustomCert = false
  private lastError: string | null = null
  private tick: ReturnType<typeof setInterval> | null = null
  private starting = false
  private lastStartKey: string | null = null
  private onStatus: (() => void) | null = null

  setStatusListener(fn: (() => void) | null): void {
    this.onStatus = fn
  }

  private notify(): void {
    this.onStatus?.()
  }

  private scheduleInput() {
    const s = settingsService.getSettings()
    return {
      mode: (s.general.webUiMode ?? 'off') as WebUiMode,
      timezone: s.general.timezone || 'UTC',
      start: s.general.webUiScheduleStart || '08:00',
      end: s.general.webUiScheduleEnd || '22:00',
      days: Array.isArray(s.general.webUiScheduleDays)
        ? s.general.webUiScheduleDays
        : [1, 2, 3, 4, 5],
    }
  }

  private ensureToken(): string {
    if (isUsableAccessToken(this.token)) return this.token
    const stored = keystoreService.getSecret(WEBUI_ACCESS_TOKEN_KEY) || ''
    if (isUsableAccessToken(stored)) {
      this.token = stored
      return this.token
    }
    this.token = generateAccessToken()
    keystoreService.setSecret(WEBUI_ACCESS_TOKEN_KEY, this.token)
    return this.token
  }

  private startKey(): string {
    const s = settingsService.getSettings()
    return [
      s.general.webUiMode ?? 'off',
      clampPort(s.general.webUiPort),
      asProtocol(s.general.webUiProtocol),
      asBind(s.general.webUiBind),
      s.general.webUiIpv6 === false ? '0' : '1',
      s.general.webUiTlsCertPath || '',
      s.general.webUiTlsKeyPath || '',
      this.token,
    ].join('|')
  }

  getStatus(): WebUiStatus {
    const input = this.scheduleInput()
    const s = settingsService.getSettings()
    const protocol = asProtocol(s.general.webUiProtocol)
    const bind = asBind(s.general.webUiBind)
    const ipv6 = s.general.webUiIpv6 !== false
    const token = this.ensureToken()
    const port = this.handle?.port ?? clampPort(s.general.webUiPort)
    const listening = this.handle !== null
    const urlOpts = { protocol, ipv6, includeLan: bind !== 'loopback' }
    const urls = listening ? listListenUrls(port, token, urlOpts) : []
    const direct = listening
      ? listDirectAccess(port, token, urlOpts)
      : { loopback: [], lanIpv4: [], lanIpv6: [] }
    return {
      mode: input.mode,
      listening,
      protocol,
      bind,
      listenHost: listenHost(bind, ipv6),
      ipv6,
      port,
      urls,
      lanIpv4: direct.lanIpv4,
      lanIpv6: direct.lanIpv6,
      inSchedule: shouldWebUiListen(input),
      fingerprintSha256: this.fingerprint,
      usingCustomCert: this.usingCustomCert,
      tokenBits: tokenBits(token),
      accessToken: token,
      error: this.lastError,
    }
  }

  async init(): Promise<void> {
    keystoreService.deleteSecret(LEGACY_CF_TUNNEL_SECRET_KEY)
    this.ensureToken()
    if (!this.tick) {
      this.tick = setInterval(() => {
        void this.syncFromSettings()
      }, TICK_MS)
      this.tick.unref?.()
    }
    await this.syncFromSettings()
  }

  async shutdown(): Promise<void> {
    if (this.tick) {
      clearInterval(this.tick)
      this.tick = null
    }
    await this.stop()
  }

  async syncFromSettings(): Promise<void> {
    const want = shouldWebUiListen(this.scheduleInput())
    this.ensureToken()
    const key = this.startKey()
    if (!want) {
      await this.stop()
      this.lastStartKey = null
      return
    }
    if (this.handle && this.lastStartKey !== key) {
      await this.stop()
    }
    await this.start()
    this.lastStartKey = key
    this.notify()
  }

  async regenerateToken(): Promise<{ success: boolean; error?: string }> {
    this.token = generateAccessToken()
    keystoreService.setSecret(WEBUI_ACCESS_TOKEN_KEY, this.token)
    this.lastStartKey = null
    await this.syncFromSettings()
    return { success: true }
  }

  async openInBrowser(): Promise<{ success: boolean; url?: string; error?: string }> {
    const status = this.getStatus()
    if (!status.listening) {
      return { success: false, error: 'WebUI 未在监听。请先改为长期开启或等到定时时段。' }
    }
    const url =
      status.urls.find((u) => u.includes('127.0.0.1')) ||
      status.urls.find((u) => u.includes('[::1]')) ||
      status.urls[0]
    if (!url) return { success: false, error: '没有可打开的地址' }
    await openExternalUrl(url)
    return { success: true, url }
  }

  private rendererRoot(): string {
    return path.join(__dirname, '..', 'renderer')
  }

  private async start(): Promise<void> {
    if (this.handle || this.starting) {
      this.notify()
      return
    }
    this.starting = true
    this.lastError = null
    try {
      const s = settingsService.getSettings()
      const protocol = asProtocol(s.general.webUiProtocol)
      const bind = asBind(s.general.webUiBind)
      const ipv6 = s.general.webUiIpv6 !== false
      const token = this.ensureToken()
      let tls = undefined as ReturnType<typeof ensureWebUiTls> | undefined
      this.usingCustomCert = false
      this.fingerprint = null
      if (protocol === 'https') {
        const tlsDir = path.join(app.getPath('userData'), 'webui-tls')
        const customPaths = {
          keyPath: s.general.webUiTlsKeyPath,
          certPath: s.general.webUiTlsCertPath,
        }
        const customTls = loadTlsFromFiles(customPaths.keyPath || '', customPaths.certPath || '')
        this.usingCustomCert = customTls !== null
        if (customPaths.certPath?.trim() && customPaths.keyPath?.trim() && !customTls) {
          this.lastError = '高级证书无法读取，已回退为自签证书'
          log('warn', 'webui', this.lastError)
        }
        tls = ensureWebUiTls(tlsDir, customPaths)
        this.fingerprint = tls.fingerprintSha256
      }
      const preferred = clampPort(s.general.webUiPort)
      const isDev =
        process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL)
      const devProxyUrl = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
        : undefined
      let lastErr: unknown
      for (let offset = 0; offset < 12; offset++) {
        const port = preferred + offset > 65535 ? preferred : preferred + offset
        try {
          this.handle = await startWebUiGateway({
            port,
            token,
            protocol,
            bind,
            ipv6,
            tls,
            rendererRoot: this.rendererRoot(),
            uploadsDir: path.join(resolveAppDataDir(), 'webui-uploads'),
            devProxyUrl,
          })
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          const code = (err as NodeJS.ErrnoException).code
          if (code !== 'EADDRINUSE') break
        }
      }
      if (!this.handle && lastErr) throw lastErr
    } catch (err) {
      this.lastError = errText(err)
      log('warn', 'webui', `gateway start failed: ${this.lastError}`)
    } finally {
      this.starting = false
      this.notify()
    }
  }

  private async stop(): Promise<void> {
    if (!this.handle) {
      this.notify()
      return
    }
    const h = this.handle
    this.handle = null
    try {
      await h.close()
    } catch (err) {
      log('warn', 'webui', `gateway stop failed: ${errText(err)}`)
    }
    this.notify()
  }
}

export const webUiService = new WebUiService()
