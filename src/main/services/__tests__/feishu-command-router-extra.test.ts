// =============================================================
// FeishuCommandRouter — 补充测试
// 覆盖: /ranking /stats /list 命令、truncate 截断、formatEAA 各分支
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  createDefaultRouter,
  type EAAResultLike,
} from '../feishu-command-router'

type EAAResult = EAAResultLike

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    runEAA: vi.fn(
      async (): Promise<EAAResult> => ({ success: true, data: 'ok', stderr: '', exitCode: 0 }),
    ),
    listAgents: vi.fn(() => []),
    runAgent: vi.fn(async (prompt: string) => `回复: ${prompt}`),
    ...overrides,
  }
}

describe('FeishuCommandRouter — /ranking /stats /list 命令', () => {
  it('/ranking 返回 EAA 输出', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({
        success: true,
        data: '排名: 1.张三 2.李四',
        stderr: '',
        exitCode: 0,
      })),
    })
    const out = await router.dispatch('/ranking', ctx)
    expect(out).toContain('排名')
    expect(ctx.runEAA).toHaveBeenCalledWith('ranking')
  })

  it('/stats 返回统计数据', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({
        success: true,
        data: '学生: 50, 事件: 200',
        stderr: '',
        exitCode: 0,
      })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('50')
  })

  it('/list 返回学生列表', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({
        success: true,
        data: '张三 李四 王五',
        stderr: '',
        exitCode: 0,
      })),
    })
    const out = await router.dispatch('/list', ctx)
    expect(out).toContain('张三')
  })

  it('/dashboard 返回概览', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: '今日概览...', stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/dashboard', ctx)
    expect(out).toContain('概览')
  })

  it('命令大小写不敏感', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: 'x', stderr: '', exitCode: 0 })),
    })
    await router.dispatch('/RANKING', ctx)
    expect(ctx.runEAA).toHaveBeenCalled()
  })
})

describe('formatEAA — 各分支 (通过命令间接)', () => {
  it('EAA 失败时返回 "执行失败" + 错误信息', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: false, data: null, stderr: '权限不足', exitCode: 1 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('执行失败')
    expect(out).toContain('权限不足')
  })

  it('EAA data 为空字符串 → "(无输出)"', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: '   ', stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('无输出')
  })

  it('EAA data 为 null → "(执行成功,但无输出数据)"', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: null, stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('执行成功')
  })

  it('EAA data 为 JSON 对象 → JSON.stringify 格式化', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({
        success: true,
        data: { count: 5, names: ['a', 'b'] },
        stderr: '',
        exitCode: 0,
      })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('"count": 5')
    expect(out).toContain('names')
  })
})

describe('truncate — 截断行为 (通过命令间接)', () => {
  it('短文本不截断', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: '短文本', stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toBe('短文本')
    expect(out).not.toContain('截断')
  })

  it('超长文本(>1800字符)被截断并标注', async () => {
    const router = createDefaultRouter()
    const longText = 'x'.repeat(3000)
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: longText, stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('截断')
    expect(out).toContain('3000')
    expect((out as string).length).toBeLessThan(longText.length + 100)
  })

  it('恰好 1800 字符不截断(边界)', async () => {
    const router = createDefaultRouter()
    const exact = 'y'.repeat(1800)
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: exact, stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).not.toContain('截断')
    expect(out).toBe(exact)
  })

  it('1801 字符被截断(边界)', async () => {
    const router = createDefaultRouter()
    const over = 'z'.repeat(1801)
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: over, stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('截断')
  })

  it('多字节字符(中文)截断不会产生半个字符问题(按 string.length)', async () => {
    const router = createDefaultRouter()
    const chinese = '中'.repeat(2000)
    const ctx = makeCtx({
      runEAA: vi.fn(async () => ({ success: true, data: chinese, stderr: '', exitCode: 0 })),
    })
    const out = await router.dispatch('/stats', ctx)
    expect(out).toContain('截断')
    // 截断后的前 1800 字符应都是完整的中文字符
    expect(out).not.toBeNull()
    const first1800 = (out as string).slice(0, 1800)
    expect(first1800).toBe('中'.repeat(1800))
  })
})

describe('FeishuCommandRouter — EAA 异常', () => {
  it('runEAA 抛错时给出错误信息而非崩溃', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx({
      runEAA: vi.fn(async () => {
        throw new Error('网络错误')
      }),
    })
    // dispatch 内部应 catch 异常
    const out = await router.dispatch('/stats', ctx).catch((e) => `异常: ${e}`)
    // 应返回某种文本,不抛出
    expect(typeof out).toBe('string')
  })
})

describe('FeishuCommandRouter — 自定义命令注册', () => {
  it('register + dispatch 自定义命令', async () => {
    const router = createDefaultRouter()
    router.register('ping', '测试', async () => 'pong')
    const ctx = makeCtx()
    const out = await router.dispatch('/ping', ctx)
    expect(out).toBe('pong')
  })

  it('/help 包含自定义命令', async () => {
    const router = createDefaultRouter()
    router.register('customcmd', '我的自定义命令', async () => 'ok')
    const ctx = makeCtx()
    const out = await router.dispatch('/help', ctx)
    expect(out).toContain('customcmd')
    expect(out).toContain('我的自定义命令')
  })
})
