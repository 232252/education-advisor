// =============================================================
// channelLoginSessions — 扫码登录会话状态机测试
// begin → poll(scanned/confirmed/expired/error/网络容错) → cancel,
// confirmed 落 keystore+settings 的绑定副作用,bound 回读。
// normalizeQrStatus/pollToken 等纯映射走真实实现。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  getBotQrcode: vi.fn(),
  getQrcodeStatus: vi.fn(),
  beginQqQrBind: vi.fn(),
  pollQqQrBind: vi.fn(),
  setSecret: vi.fn(),
  update: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((n: string) => path.join(os.tmpdir(), 'chan-login-test', n)),
    isPackaged: false,
  },
}))

vi.mock('../../src/main/services/channels/adapters/weixin/ilink-client', () => ({
  ILinkClient: class {
    getBotQrcode = mocks.getBotQrcode
    getQrcodeStatus = mocks.getQrcodeStatus
  },
}))
vi.mock('../../src/main/services/channels/adapters/qq/onboard', () => ({
  beginQqQrBind: mocks.beginQqQrBind,
  pollQqQrBind: mocks.pollQqQrBind,
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { setSecret: mocks.setSecret },
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { update: mocks.update, getSettings: mocks.getSettings },
}))

import { channelLoginSessions } from '../../src/main/services/channels/login/session-manager'

describe('channelLoginSessions 会话状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBotQrcode.mockResolvedValue({ qrcode: 'qr-1', scanUrl: 'https://qr/abc' })
    mocks.getSettings.mockReturnValue({ channels: { weixin: { baseUrl: 'https://wx/' }, qq: { appId: '10001' } } })
  })

  it('begin: 不支持的渠道抛错', async () => {
    await expect(channelLoginSessions.begin('slack')).rejects.toThrow('不支持扫码登录')
  })

  it('begin/poll: 未知会话与过期会话都报 expired', async () => {
    const r0 = await channelLoginSessions.poll('no-such-id')
    expect(r0.status).toBe('expired')

    const b = await channelLoginSessions.begin('weixin')
    expect(b.loginId).toBeTruthy()
    expect(b.channelId).toBe('weixin')
    expect(b.qrContent).toBe('https://qr/abc')
    // 未过期前 pending 透传(喂原始 waiting 也归一为 pending)
    mocks.getQrcodeStatus.mockResolvedValueOnce({ status: 'waiting' })
    const p1 = await channelLoginSessions.poll(b.loginId)
    expect(p1.status).toBe('pending')
  })

  it('cancel 后再 poll 报 expired;cancel 未知会话也返回 ok', async () => {
    const b = await channelLoginSessions.begin('weixin')
    expect(channelLoginSessions.cancel(b.loginId)).toEqual({ ok: true })
    expect((await channelLoginSessions.poll(b.loginId)).status).toBe('expired')
    expect(channelLoginSessions.cancel('ghost')).toEqual({ ok: true })
  })

  it('weixin: scanned 提示确认;unknown 状态归一为 error', async () => {
    const b = await channelLoginSessions.begin('weixin')
    mocks.getQrcodeStatus.mockResolvedValueOnce({ status: 'scaned' })
    const s = await channelLoginSessions.poll(b.loginId)
    expect(s.status).toBe('scanned')
    expect(s.detail).toContain('确认')

    mocks.getQrcodeStatus.mockResolvedValueOnce({ status: 'what-is-this' })
    const e = await channelLoginSessions.poll(b.loginId)
    expect(e.status).toBe('error')
    expect(e.detail).toContain('未知状态')
  })

  it('weixin confirmed: token 进 keystore,baseUrl 去尾斜杠,botToken 清空并启用', async () => {
    const b = await channelLoginSessions.begin('weixin')
    mocks.getQrcodeStatus.mockResolvedValueOnce({
      status: 'confirmed',
      botToken: 'tok-9',
      baseUrl: 'https://wx.example.com/',
    })
    const r = await channelLoginSessions.poll(b.loginId)
    expect(r.status).toBe('confirmed')
    expect(mocks.setSecret).toHaveBeenCalledWith('weixin-bot-token', 'tok-9')
    expect(mocks.update).toHaveBeenCalledWith('channels.weixin.baseUrl', 'https://wx.example.com')
    expect(mocks.update).toHaveBeenCalledWith('channels.weixin.botToken', '')
    expect(mocks.update).toHaveBeenCalledWith('channels.weixin.enabled', true)
    // bound 回读 settings
    expect(r.bound).toEqual({ baseUrl: 'https://wx/' })
  })

  it('weixin confirmed 无 token: error 且不写 keystore', async () => {
    const b = await channelLoginSessions.begin('weixin')
    mocks.getQrcodeStatus.mockResolvedValueOnce({ status: 'success' })
    const r = await channelLoginSessions.poll(b.loginId)
    expect(r.status).toBe('error')
    expect(r.detail).toContain('bot_token')
    expect(mocks.setSecret).not.toHaveBeenCalled()
  })

  it('weixin 网络错误: 超时/中断保持 pending,其他错误进 error', async () => {
    const b = await channelLoginSessions.begin('weixin')
    mocks.getQrcodeStatus.mockRejectedValueOnce(new Error('AbortError: signal'))
    expect((await channelLoginSessions.poll(b.loginId)).status).toBe('pending')
    mocks.getQrcodeStatus.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const r = await channelLoginSessions.poll(b.loginId)
    expect(r.status).toBe('error')
    expect(r.detail).toContain('ECONNREFUSED')
  })

  it('qq confirmed: secret 进 keystore,appId 落 settings,detail 带 AppID', async () => {
    mocks.beginQqQrBind.mockResolvedValue({ scanUrl: 'https://qq/qr', pollToken: 'pt-1' })
    const b = await channelLoginSessions.begin('qq')
    expect(b.channelId).toBe('qq')
    mocks.pollQqQrBind.mockResolvedValueOnce({
      status: 'confirmed',
      credentials: { appId: '10086', clientSecret: 'cs' },
    })
    const r = await channelLoginSessions.poll(b.loginId)
    expect(r.status).toBe('confirmed')
    expect(mocks.setSecret).toHaveBeenCalledWith('qq-client-secret', 'cs')
    expect(mocks.update).toHaveBeenCalledWith('channels.qq.appId', '10086')
    expect(mocks.update).toHaveBeenCalledWith('channels.qq.enabled', true)
    expect(r.detail).toContain('10086')
    expect(r.bound).toEqual({ appId: '10001' })
  })

  it('qq: scanned/expired 透传带提示;poll 抛错进 error', async () => {
    mocks.beginQqQrBind.mockResolvedValue({ scanUrl: 'https://qq/qr', pollToken: 'pt-2' })
    const b = await channelLoginSessions.begin('qq')
    mocks.pollQqQrBind.mockResolvedValueOnce({ status: 'scanned' })
    const s = await channelLoginSessions.poll(b.loginId)
    expect(s.status).toBe('scanned')
    expect(s.detail).toContain('确认')

    // 非终态时抛错 → error(expired 是终态,放在最后)
    mocks.pollQqQrBind.mockRejectedValueOnce(new Error('net down'))
    const e = await channelLoginSessions.poll(b.loginId)
    expect(e.status).toBe('error')
    expect(e.detail).toContain('net down')

    // expired 终态用全新会话验证(error 终态会短路后续 poll)
    const b2 = await channelLoginSessions.begin('qq')
    mocks.pollQqQrBind.mockResolvedValueOnce({ status: 'expired' })
    expect((await channelLoginSessions.poll(b2.loginId)).detail).toContain('过期')
  })
})