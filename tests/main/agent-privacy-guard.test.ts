// =============================================================
// Privacy Guard 测试 — LLM 链路自动脱敏
// 覆盖: (a) privacy list 表格解析 → 映射构建
//       (b) anonymize/deanonymize(长名优先,子串不误替换)
//       (c) 流式 carry 过滤器(化名被 delta 切断仍能还原)
//       (d) wrapTool(工具入参还原/结果脱敏)
//       (e) fail-closed: 开关开启但引擎未解锁时抛错
//       (f) 映射加载失败时 create 抛错(不静默降级)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridgeMock = vi.hoisted(() => ({
  execute: vi.fn(),
  hasPrivacyPassword: vi.fn(),
}))

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({ privacy: { enabled: false, autoAnonymize: false } })),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({ eaaBridge: bridgeMock }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: settingsMock,
}))

import {
  assertPrivacyReadyForRun,
  invalidatePrivacyGuardCache,
  isAutoAnonymizeEnabled,
  PrivacyGuard,
} from '../../src/main/services/agent/privacy-guard'

// create() 命中进程级映射缓存 — 每个用例重设 CLI mock 前必须先失效缓存,
// 否则后续用例拿到上一个用例的旧映射(fail-closed/no-op 用例即为此失败)
beforeEach(() => {
  invalidatePrivacyGuardCache()
})

const LIST_OUTPUT = [
  '类型           化名         真名',
  '学生           S_001       王小明',
  '学生           S_002       小明',
  '家长           P_001       李女士',
  '自定义         CUS_003     某某公司',
].join('\n')

async function makeGuard(listOutput = LIST_OUTPUT): Promise<PrivacyGuard> {
  bridgeMock.execute.mockResolvedValue({ success: true, data: listOutput, stderr: '', exitCode: 0 })
  return PrivacyGuard.create()
}

describe('PrivacyGuard 映射构建', () => {
  it('解析 privacy list 表格', async () => {
    const g = await makeGuard()
    expect(g.mappingCount).toBe(4)
  })

  it('CLI 失败输出(❌ 前缀)时 create 抛错(fail-closed)', async () => {
    bridgeMock.execute.mockResolvedValue({ success: true, data: '❌ 密码错误', stderr: '', exitCode: 0 })
    await expect(PrivacyGuard.create()).rejects.toThrow(/隐私映射加载失败/)
  })

  it('无映射条目时替换为 no-op', async () => {
    bridgeMock.execute.mockResolvedValue({ success: true, data: '（无映射）', stderr: '', exitCode: 0 })
    const g = await PrivacyGuard.create()
    expect(g.mappingCount).toBe(0)
    expect(g.anonymize('王小明')).toBe('王小明')
    expect(g.deanonymize('S_001')).toBe('S_001')
  })
})

describe('anonymize / deanonymize', () => {
  it('真名→化名,化名→真名', async () => {
    const g = await makeGuard()
    expect(g.anonymize('王小明 今天迟到,联系李女士')).toBe('S_001 今天迟到,联系P_001')
    expect(g.deanonymize('S_001 今天迟到,联系P_001')).toBe('王小明 今天迟到,联系李女士')
  })

  it('长名优先: "王小明" 不会被 "小明" 部分替换', async () => {
    const g = await makeGuard()
    expect(g.anonymize('王小明')).toBe('S_001')
    expect(g.anonymize('小明')).toBe('S_002')
  })

  it('多次出现全部替换', async () => {
    const g = await makeGuard()
    expect(g.anonymize('王小明和王小明')).toBe('S_001和S_001')
  })
})

describe('流式 carry 过滤器', () => {
  it('化名被 delta 边界切断仍能完整还原', async () => {
    const g = await makeGuard()
    const d = g.createStreamDeanonymizer()
    // "S_001" 切成 "S_0" + "01": 第一段扣住,第二段合并后整体替换
    expect(d.push('结果是 S_0')).toBe('结果是 ')
    expect(d.push('01 迟到')).toBe('王小明 迟到')
    expect(d.flush()).toBe('')
  })

  it('非化名文本不受影响,flush 释放残留', async () => {
    const g = await makeGuard()
    const d = g.createStreamDeanonymizer()
    expect(d.push('普通文本无化名')).toBe('普通文本无化名')
    // "S_" 是 "S_001" 的前缀 → 被扣住,其余部分正常吐出
    expect(d.push('尾部可能是 S_')).toBe('尾部可能是 ')
    expect(d.flush()).toBe('S_')
  })
})

describe('wrapTool', () => {
  it('入参化名→真名,结果真名→化名', async () => {
    const g = await makeGuard()
    const calls: Array<Record<string, unknown>> = []
    const tool = g.wrapTool({
      name: 'eaa_add_event',
      execute: async (_id: string, params: Record<string, unknown>) => {
        calls.push(params)
        return `事件已添加: ${params.student_name} 迟到扣 2 分`
      },
    })
    const result = await tool.execute('tc1', { student_name: 'S_001', delta: -2 })
    // 执行时收到真名
    expect(calls[0].student_name).toBe('王小明')
    // 返回给模型的结果被重新脱敏
    expect(result).toBe('事件已添加: S_001 迟到扣 2 分')
  })

  it('AgentToolResult 对象形态的结果同样被脱敏(真实 EAA 工具的返回形态)', async () => {
    const g = await makeGuard()
    const tool = g.wrapTool({
      name: 'eaa_score',
      execute: async () => ({
        content: [{ type: 'text', text: '王小明 当前 62 分' }],
        details: {},
      }),
    })
    const result = (await tool.execute('tc1', {})) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toBe('S_001 当前 62 分')
  })
})

describe('fail-closed 开关', () => {
  it('隐私关闭时 isAutoAnonymizeEnabled=false', () => {
    settingsMock.getSettings.mockReturnValue({ privacy: { enabled: false, autoAnonymize: false } })
    expect(isAutoAnonymizeEnabled()).toBe(false)
    expect(() => assertPrivacyReadyForRun()).not.toThrow()
  })

  it('开启但未解锁时 assert 抛错(fail-closed)', () => {
    settingsMock.getSettings.mockReturnValue({ privacy: { enabled: true, autoAnonymize: true } })
    bridgeMock.hasPrivacyPassword.mockReturnValue(false)
    expect(isAutoAnonymizeEnabled()).toBe(true)
    expect(() => assertPrivacyReadyForRun()).toThrow(/隐私引擎尚未解锁/)
  })

  it('开启且已解锁时通过', () => {
    settingsMock.getSettings.mockReturnValue({ privacy: { enabled: true, autoAnonymize: true } })
    bridgeMock.hasPrivacyPassword.mockReturnValue(true)
    expect(() => assertPrivacyReadyForRun()).not.toThrow()
  })
})
