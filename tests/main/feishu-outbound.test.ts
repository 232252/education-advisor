// =============================================================
// R2-28 飞书出站直测 — f6e8d36 新增链路中最脆弱的一环
// 覆盖: (a) 未配置 → skipped(降级不算错误)
//       (b) appSecret 缺失 → skipped
//       (c) 超长文本截断(3500 字符上限)
//       (d) sendTextMessage 失败 → {success:false,error}
//       (e) 成功路径 payload(标题 + 正文)
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({
    feishu: { appId: 'cli_test', appSecret: 'remote-secret', userOpenId: 'ou_teacher', domain: 'feishu' },
  })),
}))

const keystoreMock = vi.hoisted(() => ({
  getSecret: vi.fn((name: string) => (name === 'feishu-app-secret' ? 'secret-123' : undefined)),
}))

const messagesMock = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
}))

vi.mock('../../src/main/services/settings-service', () => ({ settingsService: settingsMock }))
vi.mock('../../src/main/services/keystore-service', () => ({ keystoreService: keystoreMock }))
vi.mock('../../src/main/services/feishu/messages', () => ({ sendTextMessage: messagesMock.sendTextMessage }))

import {
  FEISHU_PUSH_AGENT_IDS,
  isFeishuPushConfigured,
  sendAgentAlert,
} from '../../src/main/services/feishu/alerts'

describe('sendAgentAlert', () => {
  it('未配置 appId/userOpenId → skipped(降级不是错误)', async () => {
    settingsMock.getSettings.mockReturnValueOnce({
      feishu: { appId: '', userOpenId: '', domain: 'feishu' },
    })
    const r = await sendAgentAlert('周报完成', '正文')
    expect(r.success).toBe(false)
    expect(r.skipped).toContain('未配置')
    expect(messagesMock.sendTextMessage).not.toHaveBeenCalled()
  })

  it('appSecret 缺失(keystore)→ skipped', async () => {
    keystoreMock.getSecret.mockReturnValueOnce(undefined)
    const r = await sendAgentAlert('周报完成', '正文')
    expect(r.skipped).toContain('appSecret')
  })

  it('超长文本按 3500 字符截断并带标记', async () => {
    messagesMock.sendTextMessage.mockResolvedValue({ success: true })
    const long = '长'.repeat(5000)
    await sendAgentAlert('周报完成', long)
    const [, , , text] = messagesMock.sendTextMessage.mock.calls[0]!
    expect(text.length).toBeLessThanOrEqual(3500 + 30)
    expect(text).toContain('已截断')
  })

  it('sendTextMessage 抛错 → {success:false,error}(不吞异常)', async () => {
    messagesMock.sendTextMessage.mockRejectedValueOnce(new Error('token expired'))
    const r = await sendAgentAlert('预警', '内容')
    expect(r.success).toBe(false)
    expect(r.error).toContain('token expired')
  })

  it('成功路径: 标题包裹 + 正文透传 + 收件人为教师 openId', async () => {
    messagesMock.sendTextMessage.mockResolvedValue({ success: true })
    const r = await sendAgentAlert('风险预警', '张三需关注')
    expect(r.success).toBe(true)
    expect(messagesMock.sendTextMessage).toHaveBeenCalledWith(
      'cli_test',
      'secret-123',
      'ou_teacher',
      '【风险预警】\n张三需关注',
      'feishu',
    )
  })

  it('FEISHU_PUSH_AGENT_IDS 只含报告类角色', () => {
    expect(FEISHU_PUSH_AGENT_IDS).toContain('weekly-reporter')
    expect(FEISHU_PUSH_AGENT_IDS).toContain('risk-alert')
    expect(FEISHU_PUSH_AGENT_IDS).not.toContain('class-monitor')
  })

  it('isFeishuPushConfigured 反映基本配置', () => {
    expect(isFeishuPushConfigured()).toBe(true)
  })
})
