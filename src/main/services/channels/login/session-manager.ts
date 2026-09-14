// =============================================================
// channels/login/session-manager — 扫码登录会话状态机
// begin → poll → confirmed(写 settings/keystore) | expired | error | cancel
// =============================================================

import { randomUUID } from 'node:crypto'
import { log } from '../../../utils/logger'
import { keystoreService } from '../../keystore-service'
import { settingsService } from '../../settings-service'
import { ILinkClient } from '../adapters/weixin/ilink-client'
import { normalizeQrStatus } from '../adapters/weixin/headers'
import { WEIXIN_DEFAULT_BASE_URL, WEIXIN_MANIFEST_ID } from '../adapters/weixin/constants'
import { beginQqQrBind, pollQqQrBind } from '../adapters/qq/onboard'
import { QQ_MANIFEST_ID } from '../adapters/qq/constants'
import type { ChannelLoginBeginResult, ChannelLoginPollResult, ChannelLoginStatus } from './types'

interface SessionBase {
  loginId: string
  channelId: string
  createdAt: number
  expiresAt: number
  status: ChannelLoginStatus
  detail?: string
  cancelled?: boolean
}

interface WeixinSession extends SessionBase {
  channelId: typeof WEIXIN_MANIFEST_ID
  qrcode: string
  qrContent: string
  client: ILinkClient
}

interface QqSession extends SessionBase {
  channelId: typeof QQ_MANIFEST_ID
  pollToken: string
  qrContent: string
}

type LoginSession = WeixinSession | QqSession

const SESSION_TTL_MS = 5 * 60 * 1000

class ChannelLoginSessionManager {
  private sessions = new Map<string, LoginSession>()

  async begin(channelId: string): Promise<ChannelLoginBeginResult> {
    this.gc()
    if (channelId === WEIXIN_MANIFEST_ID) return this.beginWeixin()
    if (channelId === QQ_MANIFEST_ID) return this.beginQq()
    throw new Error(`渠道 ${channelId} 不支持扫码登录`)
  }

  async poll(loginId: string): Promise<ChannelLoginPollResult> {
    const session = this.sessions.get(loginId)
    if (!session) return { status: 'expired', detail: '登录会话不存在或已过期' }
    if (session.cancelled) return { status: 'cancelled' }
    if (Date.now() > session.expiresAt) {
      session.status = 'expired'
      return { status: 'expired', detail: '二维码已过期,请重新扫码' }
    }
    if (session.status === 'confirmed' || session.status === 'error' || session.status === 'expired') {
      return this.toPollResult(session)
    }

    if (session.channelId === WEIXIN_MANIFEST_ID) {
      await this.pollWeixin(session)
    } else if (session.channelId === QQ_MANIFEST_ID) {
      await this.pollQq(session)
    }
    return this.toPollResult(session)
  }

  cancel(loginId: string): { ok: boolean } {
    const session = this.sessions.get(loginId)
    if (!session) return { ok: true }
    session.cancelled = true
    session.status = 'cancelled'
    this.sessions.delete(loginId)
    return { ok: true }
  }

  private async beginWeixin(): Promise<ChannelLoginBeginResult> {
    const client = new ILinkClient({ baseUrl: WEIXIN_DEFAULT_BASE_URL })
    const qr = await client.getBotQrcode()
    const loginId = randomUUID()
    const expiresAt = Date.now() + SESSION_TTL_MS
    const session: WeixinSession = {
      loginId,
      channelId: WEIXIN_MANIFEST_ID,
      createdAt: Date.now(),
      expiresAt,
      status: 'pending',
      qrcode: qr.qrcode,
      qrContent: qr.scanUrl,
      client,
    }
    this.sessions.set(loginId, session)
    return { loginId, channelId: WEIXIN_MANIFEST_ID, qrContent: qr.scanUrl, expiresAt }
  }

  private async beginQq(): Promise<ChannelLoginBeginResult> {
    const { scanUrl, pollToken } = await beginQqQrBind()
    const loginId = randomUUID()
    const expiresAt = Date.now() + SESSION_TTL_MS
    const session: QqSession = {
      loginId,
      channelId: QQ_MANIFEST_ID,
      createdAt: Date.now(),
      expiresAt,
      status: 'pending',
      pollToken,
      qrContent: scanUrl,
    }
    this.sessions.set(loginId, session)
    return { loginId, channelId: QQ_MANIFEST_ID, qrContent: scanUrl, expiresAt }
  }

  private async pollWeixin(session: WeixinSession): Promise<void> {
    try {
      const result = await session.client.getQrcodeStatus(session.qrcode)
      const st = normalizeQrStatus(result.status)
      if (st === 'confirmed') {
        const token = result.botToken
        if (!token) {
          session.status = 'error'
          session.detail = '扫码确认但未返回 bot_token'
          return
        }
        const baseUrl = (result.baseUrl || WEIXIN_DEFAULT_BASE_URL).replace(/\/$/, '')
        keystoreService.setSecret('weixin-bot-token', token)
        settingsService.update('channels.weixin.baseUrl', baseUrl)
        settingsService.update('channels.weixin.botToken', '')
        settingsService.update('channels.weixin.enabled', true)
        session.status = 'confirmed'
        session.detail = '微信已绑定'
        log('info', 'channels-login', 'weixin QR confirmed, token saved to keystore')
        return
      }
      if (st === 'expired') {
        session.status = 'expired'
        session.detail = '二维码已过期'
        return
      }
      if (st === 'scanned') {
        session.status = 'scanned'
        session.detail = '已扫码,请在手机上确认'
        return
      }
      if (st === 'error') {
        session.status = 'error'
        session.detail = `未知状态: ${result.status}`
        return
      }
      session.status = 'pending'
    } catch (err) {
      // 长超时属正常,保持 pending
      const msg = err instanceof Error ? err.message : String(err)
      if (/abort|timeout|TimeoutError|AbortError/i.test(msg)) return
      session.status = 'error'
      session.detail = msg
    }
  }

  private async pollQq(session: QqSession): Promise<void> {
    try {
      const result = await pollQqQrBind(session.pollToken)
      if (result.status === 'confirmed') {
        const { appId, clientSecret } = result.credentials
        keystoreService.setSecret('qq-client-secret', clientSecret)
        settingsService.update('channels.qq.appId', appId)
        settingsService.update('channels.qq.clientSecret', '')
        settingsService.update('channels.qq.enabled', true)
        session.status = 'confirmed'
        session.detail = `QQ 已绑定 AppID ${appId}`
        log('info', 'channels-login', `qq QR confirmed, appId=${appId}`)
        return
      }
      session.status = result.status
      if (result.status === 'error') session.detail = result.message
      if (result.status === 'expired') session.detail = '二维码已过期'
      if (result.status === 'scanned') session.detail = '已扫码,请在手机上确认'
    } catch (err) {
      session.status = 'error'
      session.detail = err instanceof Error ? err.message : String(err)
    }
  }

  private toPollResult(session: LoginSession): ChannelLoginPollResult {
    const bound =
      session.status === 'confirmed'
        ? session.channelId === QQ_MANIFEST_ID
          ? { appId: String(settingsService.getSettings().channels?.qq?.appId ?? '') }
          : { baseUrl: String(settingsService.getSettings().channels?.weixin?.baseUrl ?? '') }
        : undefined
    return { status: session.status, detail: session.detail, bound }
  }

  private gc(): void {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      if (now > s.expiresAt + 60_000 || s.cancelled) this.sessions.delete(id)
    }
  }
}

export const channelLoginSessions = new ChannelLoginSessionManager()
