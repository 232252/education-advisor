// =============================================================
// EAA Tools — 各工具 execute 路径测试
// 验证: ranking/stats/codes/summary/list/range/score 工具正确调用 eaaBridge
// 通过 mock eaaBridge 验证传入的 command/args
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: bridge,
  getErrorMessage: (r: { success: boolean; data?: string; stderr?: string }, f: string) =>
    typeof r.data === 'string' && r.data ? r.data : r.stderr || f,
}))

// R2+: eaa-tools 经 academic-tools → academic-service → utils/logger 链在模块
// 顶层调用 app.getPath('userData'),仅 mock eaa-bridge 不再够用 — 补 electron app mock
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/eaa-tools-isolated-test'),
    isPackaged: false,
  },
}))

const { rankingTool, statsTool, codesTool, summaryTool, listStudentsTool, rangeTool, queryScoreTool } =
  await import('../../src/main/services/eaa-tools')

function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content[0]?.text ?? ''
}

describe('eaa-tools execute — rankingTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('无参数时调用 ranking 无 args', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { ranking: [] }, stderr: '', exitCode: 0 })
    await rankingTool.execute('t', {})
    expect(bridge.execute).toHaveBeenCalledWith({ command: 'ranking', args: [] })
  })

  it('有 n 参数时传入 String(n)', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { ranking: [] }, stderr: '', exitCode: 0 })
    await rankingTool.execute('t', { n: 20 })
    expect(bridge.execute).toHaveBeenCalledWith({ command: 'ranking', args: ['20'] })
  })

  it('失败时抛错含 getErrorMessage', async () => {
    bridge.execute.mockResolvedValue({ success: false, data: '查询失败', stderr: '', exitCode: 1 })
    await expect(rankingTool.execute('t', {})).rejects.toThrow('排行榜获取失败')
  })

  it('成功时返回 JSON 结果', async () => {
    bridge.execute.mockResolvedValue({
      success: true,
      data: { ranking: [{ rank: 1, name: '张三' }] },
      stderr: '',
      exitCode: 0,
    })
    const r = await rankingTool.execute('t', {})
    expect(textOf(r)).toContain('张三')
  })
})

describe('eaa-tools execute — statsTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('调用 stats 无 args', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: {}, stderr: '', exitCode: 0 })
    await statsTool.execute('t', {})
    expect(bridge.execute).toHaveBeenCalledWith({ command: 'stats', args: [] })
  })

  it('失败时抛错', async () => {
    bridge.execute.mockResolvedValue({ success: false, data: null, stderr: 'err', exitCode: 1 })
    await expect(statsTool.execute('t', {})).rejects.toThrow('统计获取失败')
  })
})

describe('eaa-tools execute — codesTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('调用 codes 无 args', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { codes: [] }, stderr: '', exitCode: 0 })
    await codesTool.execute('t', {})
    expect(bridge.execute).toHaveBeenCalledWith({ command: 'codes', args: [] })
  })
})

describe('eaa-tools execute — listStudentsTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('调用 list-students 无 args', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { students: [] }, stderr: '', exitCode: 0 })
    await listStudentsTool.execute('t', {})
    expect(bridge.execute).toHaveBeenCalledWith({ command: 'list-students', args: [] })
  })

  it('失败时抛错', async () => {
    bridge.execute.mockResolvedValue({ success: false, data: '', stderr: 'db locked', exitCode: 1 })
    await expect(listStudentsTool.execute('t', {})).rejects.toThrow('列表获取失败')
  })

  it('超过 200 名学生时截断并标注(大库防爆)', async () => {
    const students = Array.from({ length: 260 }, (_, i) => ({ name: `学生${i}`, score: 100 }))
    bridge.execute.mockResolvedValue({
      success: true,
      data: { students, total: 260 },
      stderr: '',
      exitCode: 0,
    })
    const r = (await listStudentsTool.execute('t', {})) as {
      content: Array<{ type: string; text?: string }>
    }
    const parsed = JSON.parse(textOf(r)) as {
      students: unknown[]
      total: number
      students_truncated?: string
    }
    expect(parsed.students).toHaveLength(200)
    expect(parsed.total).toBe(260)
    expect(parsed.students_truncated).toContain('200/260')
    expect(parsed.students_truncated).toContain('eaa_ranking')
  })

  it('不超过 200 名时不截断', async () => {
    const students = Array.from({ length: 50 }, (_, i) => ({ name: `学生${i}` }))
    bridge.execute.mockResolvedValue({
      success: true,
      data: { students, total: 50 },
      stderr: '',
      exitCode: 0,
    })
    const r = (await listStudentsTool.execute('t', {})) as {
      content: Array<{ type: string; text?: string }>
    }
    const parsed = JSON.parse(textOf(r)) as { students: unknown[]; students_truncated?: string }
    expect(parsed.students).toHaveLength(50)
    expect(parsed.students_truncated).toBeUndefined()
  })

  it('传 class_id 时只返回该班学生', async () => {
    bridge.execute.mockResolvedValue({
      success: true,
      data: {
        students: [
          { name: '测试甲', class_id: 'G12-5' },
          { name: '测试丁', class_id: 'G10-4' },
          { name: '测试丙', class_id: 'G12-5' },
        ],
        total: 3,
      },
      stderr: '',
      exitCode: 0,
    })
    const r = (await listStudentsTool.execute('t', { class_id: 'G12-5' })) as {
      content: Array<{ type: string; text?: string }>
    }
    const parsed = JSON.parse(textOf(r)) as { students: Array<{ name: string }>; total: number; names: string[] }
    expect(parsed.total).toBe(2)
    expect(parsed.names).toEqual(['测试甲', '测试丙'])
    expect(parsed.students.map((s) => s.name)).toEqual(['测试甲', '测试丙'])
  })
})

describe('eaa-tools execute — summaryTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('无 since/until 时调用 summary(通过 safeExecute)', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: {}, stderr: '', exitCode: 0 })
    await summaryTool.execute('t', {})
    expect(bridge.execute).toHaveBeenCalled()
    const call = bridge.execute.mock.calls[0][0]
    expect(call.command).toBe('summary')
  })

  it('有 since/until 时传入 flags', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: {}, stderr: '', exitCode: 0 })
    await summaryTool.execute('t', { since: '2026-01-01', until: '2026-06-30' })
    const call = bridge.execute.mock.calls[0][0]
    expect(call.args).toContain('--since')
    expect(call.args).toContain('2026-01-01')
    expect(call.args).toContain('--until')
    expect(call.args).toContain('2026-06-30')
  })

  it('start/end 是 since/until 的等价别名(统一区间参数口径)', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: {}, stderr: '', exitCode: 0 })
    await summaryTool.execute('t', { start: '2026-01-01', end: '2026-06-30' })
    const call = bridge.execute.mock.calls[0][0]
    expect(call.args).toContain('--since')
    expect(call.args).toContain('2026-01-01')
    expect(call.args).toContain('--until')
    expect(call.args).toContain('2026-06-30')
  })

  it('显式 since/until 与别名同时存在时显式参数优先', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: {}, stderr: '', exitCode: 0 })
    await summaryTool.execute('t', { since: '2026-02-01', start: '2026-01-01', until: '2026-06-30' })
    const call = bridge.execute.mock.calls[0][0]
    const sinceIdx = call.args.indexOf('--since')
    expect(call.args[sinceIdx + 1]).toBe('2026-02-01')
  })
})

describe('eaa-tools execute — rangeTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('传入 start/end/limit', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { events: [] }, stderr: '', exitCode: 0 })
    await rangeTool.execute('t', { start: '2026-01-01', end: '2026-12-31', limit: 50 })
    const call = bridge.execute.mock.calls[0][0]
    expect(call.command).toBe('range')
    expect(call.args).toContain('2026-01-01')
    expect(call.args).toContain('2026-12-31')
  })

  it('失败时抛错', async () => {
    bridge.execute.mockResolvedValue({ success: false, data: null, stderr: 'err', exitCode: 1 })
    await expect(
      rangeTool.execute('t', { start: '2026-01-01', end: '2026-12-31' }),
    ).rejects.toThrow()
  })
})

describe('eaa-tools execute — queryScoreTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('传入学生姓名', async () => {
    bridge.execute.mockResolvedValue({ success: true, data: { score: 10 }, stderr: '', exitCode: 0 })
    await queryScoreTool.execute('t', { name: '张三' })
    const call = bridge.execute.mock.calls[0][0]
    expect(call.command).toBe('score')
    expect(call.args).toContain('张三')
  })

  it('成功返回分数', async () => {
    bridge.execute.mockResolvedValue({
      success: true,
      data: { name: '张三', score: 42 },
      stderr: '',
      exitCode: 0,
    })
    const r = await queryScoreTool.execute('t', { name: '张三' })
    expect(textOf(r)).toContain('42')
  })

  it('失败抛错', async () => {
    bridge.execute.mockResolvedValue({ success: false, data: '未找到', stderr: '', exitCode: 1 })
    await expect(queryScoreTool.execute('t', { name: '不存在' })).rejects.toThrow('查询失败')
  })
})
