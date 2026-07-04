// =============================================================
// FeishuCommandRouter 测试 — 解析逻辑 + 命令分发
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import {
  type CommandContext,
  createDefaultRouter,
  type EAAResultLike,
  parseCommand,
} from '../feishu-command-router'

// 由于 eaa-bridge 在 vitest 环境下可能无法直接 import(Electron 主进程依赖),
// 这里用一个本地 EAAResult 兼容类型,避免引入真实 EAAResult。
type EAAResult = EAAResultLike

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    runEAA: vi.fn(
      async (): Promise<EAAResult> => ({ success: true, data: 'ok', stderr: '', exitCode: 0 }),
    ),
    listAgents: vi.fn(() => [
      { id: 'supervisor', name: '督导', description: '督导 agent' },
      { id: 'counselor', name: '辅导员' },
    ]),
    runAgent: vi.fn(async (prompt: string) => `回复: ${prompt}`),
    ...overrides,
  }
}

describe('parseCommand', () => {
  it('解析无参数命令', () => {
    expect(parseCommand('/help')).toEqual({ command: 'help', args: [], rawArgs: '' })
  })

  it('解析带参数命令', () => {
    expect(parseCommand('/score 张三')).toEqual({
      command: 'score',
      args: ['张三'],
      rawArgs: '张三',
    })
  })

  it('解析多个参数', () => {
    expect(parseCommand('/echo hello world')).toEqual({
      command: 'echo',
      args: ['hello', 'world'],
      rawArgs: 'hello world',
    })
  })

  it('命令名转小写(大小写不敏感)', () => {
    expect(parseCommand('/HELP')).toEqual({ command: 'help', args: [], rawArgs: '' })
    expect(parseCommand('/Dashboard')).toEqual({ command: 'dashboard', args: [], rawArgs: '' })
  })

  it('去除首尾空白', () => {
    expect(parseCommand('   /help   ')).toEqual({ command: 'help', args: [], rawArgs: '' })
  })

  it('普通文本返回 null', () => {
    expect(parseCommand('你好')).toBeNull()
    expect(parseCommand('查一下张三的分数')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })

  it('只有斜杠返回空命令', () => {
    expect(parseCommand('/')).toEqual({ command: '', args: [], rawArgs: '' })
  })
})

describe('FeishuCommandRouter dispatch', () => {
  it('非命令文本返回 null(应由调用方转 Agent)', async () => {
    const router = createDefaultRouter()
    const ctx = makeCtx()
    expect(await router.dispatch('你好', ctx)).toBeNull()
    expect(ctx.runAgent).not.toHaveBeenCalled()
  })

  it('未知命令给出提示', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/nope', makeCtx())
    expect(reply).toContain('未知命令')
    expect(reply).toContain('/help')
  })

  it('只有斜杠给出引导', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/', makeCtx())
    expect(reply).toContain('/help')
  })

  it('/echo 回显参数', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/echo test 123', makeCtx())
    expect(reply).toBe('test 123')
  })

  it('/echo 无参数时提示空', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/echo', makeCtx())
    expect(reply).toBe('(空)')
  })

  it('/agents 列出 Agent', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/agents', makeCtx())
    expect(reply).toContain('共 2 个 Agent')
    expect(reply).toContain('supervisor')
    expect(reply).toContain('counselor')
  })

  it('/score 缺参数给提示', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/score', makeCtx())
    expect(reply).toContain('请提供学生姓名')
  })

  it('/score 带参数调用 EAA', async () => {
    const router = createDefaultRouter()
    const runEAA = vi.fn(
      async (): Promise<EAAResult> => ({
        success: true,
        data: '张三 当前操行: 92',
        stderr: '',
        exitCode: 0,
      }),
    )
    const reply = await router.dispatch('/score 张三', makeCtx({ runEAA }))
    expect(runEAA).toHaveBeenCalledWith('score', ['张三'])
    expect(reply).toContain('张三 当前操行: 92')
  })

  it('EAA 失败时格式化错误', async () => {
    const router = createDefaultRouter()
    const runEAA = vi.fn(
      async (): Promise<EAAResult> => ({
        success: false,
        data: null,
        stderr: 'student not found',
        exitCode: 1,
      }),
    )
    const reply = await router.dispatch('/score 未知', makeCtx({ runEAA }))
    expect(reply).toContain('执行失败')
    expect(reply).toContain('student not found')
  })

  it('EAA 文本输出被截断到合理长度', async () => {
    const router = createDefaultRouter()
    const longText = 'x'.repeat(3000)
    const reply = await router.dispatch(
      '/dashboard',
      makeCtx({
        runEAA: vi.fn(
          async (): Promise<EAAResult> => ({
            success: true,
            data: longText,
            stderr: '',
            exitCode: 0,
          }),
        ),
      }),
    )
    // dispatch 对命令一定返回字符串;用类型守卫避免 non-null assertion
    if (reply === null) {
      expect.unreachable('dashboard 命令应返回字符串')
      return
    }
    expect(reply.length).toBeLessThan(longText.length)
    expect(reply).toContain('已截断')
  })

  it('处理器抛异常时给出错误信息而非崩溃', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch(
      '/dashboard',
      makeCtx({
        runEAA: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    )
    expect(reply).toContain('执行失败')
    expect(reply).toContain('boom')
  })

  it('命令大小写不敏感', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/HELP', makeCtx())
    expect(reply).toContain('可用斜杠命令')
  })

  it('/help 包含所有已注册命令', async () => {
    const router = createDefaultRouter()
    const reply = await router.dispatch('/help', makeCtx())
    expect(reply).toContain('/help')
    expect(reply).toContain('/agents')
    expect(reply).toContain('/score')
    expect(reply).toContain('/dashboard')
    expect(reply).toContain('/ranking')
    expect(reply).toContain('/echo')
  })
})

describe('FeishuCommandRouter 自定义注册', () => {
  it('支持注册自定义命令', async () => {
    const router = createDefaultRouter()
    router.register('ping', '测试连通性', async () => 'pong')
    const reply = await router.dispatch('/ping', makeCtx())
    expect(reply).toBe('pong')
  })
})
