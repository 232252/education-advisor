// =============================================================
// escalate_to_main 工具 + bitable 真实快照 测试
// (a) escalate: main 上报入队 + 飞书推送各分支的返回文案
// (b) composeSnapshotMessage: 解析 eaa summary 真实文本表格 → 快照文案
//     (表格样例取自 eaa v3.2.5 linux 二进制的实际输出)
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    userDataDir: require('node:path').join(require('node:os').tmpdir(), 'eaa-escalation-test'),
    getPath: vi.fn((n: string) => (n === 'userData' ? mocks.userDataDir : '')),
  }
})

// bitable-sync → utils/logger → log/state 在模块顶层调用 app.getPath
vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

const bridgeMock = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('../../src/main/services/eaa-bridge', () => ({ eaaBridge: bridgeMock }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: vi.fn(() => ({})) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getSecret: vi.fn(() => '') },
}))

import { createEscalateToMainTool, escalateParams } from '../../src/main/services/agent/escalation-tool'
import { composeSnapshotMessage } from '../../src/main/services/cron/bitable-sync'
import { Check } from 'typebox/value'

describe('escalate_to_main 工具', () => {
  it('schema 校验必填字段', () => {
    expect(Check(escalateParams, { severity: 'critical', summary: '张三高危' })).toBe(true)
    expect(Check(escalateParams, { summary: '缺 severity' })).toBe(false)
  })

  it('入队成功 + 飞书推送成功', async () => {
    const tool = createEscalateToMainTool(
      {
        enqueueMainReport: vi.fn().mockResolvedValue(true),
        sendFeishuAlert: vi.fn().mockResolvedValue({ success: true }),
      },
      { sourceAgentId: 'psychology' },
    )
    const result = (await tool.execute('tc1', {
      severity: 'critical',
      summary: '张三出现高危信号',
      detail: '建议今日面谈',
    })) as { content: Array<{ text: string }> }
    const text = result.content[0].text
    expect(text).toContain('已上报给主协调 Agent')
    expect(text).toContain('已通过飞书推送给班主任')
    expect(text).toContain('critical 级上报')
  })

  it('入队失败 + 飞书未配置(skipped)', async () => {
    const tool = createEscalateToMainTool(
      {
        enqueueMainReport: vi.fn().mockResolvedValue(false),
        sendFeishuAlert: vi.fn().mockResolvedValue({ success: false, skipped: 'feishu appId/userOpenId 未配置' }),
      },
      { sourceAgentId: 'risk-alert' },
    )
    const result = (await tool.execute('tc1', {
      severity: 'warning',
      summary: '分数骤降',
    })) as { content: Array<{ text: string }> }
    const text = result.content[0].text
    expect(text).toContain('上报 main 失败')
    expect(text).toContain('飞书推送跳过')
  })

  it('超长 summary/detail 被封顶(runaway 输出不灌爆 main 上下文)', async () => {
    const enqueue = vi.fn().mockResolvedValue(true)
    const tool = createEscalateToMainTool({ enqueueMainReport: enqueue }, { sourceAgentId: 'psychology' })
    await tool.execute('tc1', {
      severity: 'critical',
      summary: 's'.repeat(2000),
      detail: 'd'.repeat(8000),
    })
    const reported = enqueue.mock.calls[0][0] as string
    expect(reported).toContain(`${'s'.repeat(500)}…(超长已截断至 500/2000 字符)`)
    expect(reported).toContain(`${'d'.repeat(2000)}…(超长已截断至 2000/8000 字符)`)
    expect(reported).not.toContain('s'.repeat(501))
  })

  it('非法 severity 归一化时回显实际级别(不静默降级)', async () => {
    const enqueue = vi.fn().mockResolvedValue(true)
    const tool = createEscalateToMainTool({ enqueueMainReport: enqueue }, { sourceAgentId: 'psychology' })
    // 直接以越权调用构造(schema 会拦,这里测运行时防御路径)
    const result = (await tool.execute('tc1', {
      severity: 'high' as unknown as 'critical',
      summary: '测试',
    })) as { content: Array<{ text: string }> }
    const text = result.content[0].text
    expect(text).toContain('不是合法值')
    expect(text).toContain('已按 warning 级记录')
    expect(enqueue.mock.calls[0][0]).toContain('[紧急上报][warning]')
  })
})

describe('composeSnapshotMessage(bitable 真实快照)', () => {
  // eaa v3.2.5 `summary` 实际输出(节选关键行)
  const REAL_SUMMARY = [
    '╔══════════════════════════════════════╗',
    '║       EAA 区间汇总 v3.1.2            ║',
    '╠══════════════════════════════════════╣',
    '║ 事件数:       50                   ║',
    '║ 加分:         13次 总计+28.0          ║',
    '║ 扣分:         37次 总计-93.0          ║',
    '╠══════════════════════════════════════╣',
    '║ 风险分布:',
    '║   极高          0人',
    '║   低         1648人',
    '║   中          12人',
    '║   高           0人',
    '╠══════════════════════════════════════╣',
    '║ TOP原因码:',
    '║   LATE                          7次',
    '╚══════════════════════════════════════╝',
  ].join('\n')

  it('解析真实 summary 表格 → 含事件数/加减分/非零风险', async () => {
    bridgeMock.execute.mockResolvedValue({ success: true, data: REAL_SUMMARY, stderr: '', exitCode: 0 })
    const msg = await composeSnapshotMessage()
    expect(msg).toContain('有效事件50条')
    expect(msg).toContain('加分13次')
    expect(msg).toContain('扣分37次')
    expect(msg).toContain('低风险1648人')
    expect(msg).toContain('中风险12人')
    expect(msg).not.toContain('极高风险0人') // 零值不注入
  })

  it('查询失败 → snapshot unavailable 降级(不抛错)', async () => {
    bridgeMock.execute.mockResolvedValue({ success: false, data: null, stderr: 'boom', exitCode: 1 })
    const msg = await composeSnapshotMessage()
    expect(msg).toContain('snapshot unavailable')
  })
})
