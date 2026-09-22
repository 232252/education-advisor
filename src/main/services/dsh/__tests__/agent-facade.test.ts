import type { AgentEvent, Api, Model } from '@main/services/llm-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDshAgent, DshAgentFacade, type DshTurnSource } from '../agent-facade'
import type { DshChatStreamParams } from '../runtime'
import type { DshSessionEvent } from '../wire-types'

const model = {
  id: 'deepseek-v4-flash',
  api: 'openai-completions' as unknown as Api,
  provider: 'deepseek',
  maxTokens: 8192,
} as Model<Api>

async function* of(...events: DshSessionEvent[]): AsyncGenerator<DshSessionEvent> {
  for (const e of events) yield e
}

async function* gated(
  gate: Promise<void>,
  ...events: DshSessionEvent[]
): AsyncGenerator<DshSessionEvent> {
  await gate
  yield* of(...events)
}

/** 脚本化原始事件源：可注入抛错，用来覆盖中断路径 */
function sourceFactory(
  script: (params: DshChatStreamParams) => AsyncGenerator<DshSessionEvent>,
  onError?: Error,
) {
  const seen: DshChatStreamParams[] = []
  let disposed = 0
  const source: DshTurnSource = {
    turnEvents(params) {
      seen.push(params)
      // 直接抛：facade 的 pump 是 async，同步抛出同样被它的 try/catch 接住
      if (onError) throw onError
      return script(params)
    },
    async dispose() {
      disposed += 1
    },
  }
  return { source, seen, disposedOf: () => disposed }
}

const assistant = (texts: string[]): DshSessionEvent =>
  ({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      stream: [{ type: 'text-chunks', texts }],
      usage: { inputTokens: 3, outputTokens: 4 },
    },
  }) as unknown as DshSessionEvent

const turnEnd = (reason: 'completed' | 'aborted' | 'error' = 'completed'): DshSessionEvent =>
  ({ type: 'turn/end', data: { turn: 1, reason } }) as unknown as DshSessionEvent

function facade(source: DshTurnSource): DshAgentFacade {
  return new DshAgentFacade({ runtime: source, model, systemPrompt: '你是班主任助手' })
}

function collect(f: DshAgentFacade): AgentEvent[] {
  const out: AgentEvent[] = []
  f.subscribe((e) => out.push(e))
  return out
}

const firstText = (params: DshChatStreamParams): string => {
  const first = params.blocks?.[0]
  return first && first.type === 'text' ? first.text : ''
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DshAgentFacade', () => {
  it('prompt 后按序投影 message_update / turn_end / agent_end，并释放 idle', async () => {
    const { source, seen } = sourceFactory(() => of(assistant(['你', '好']), turnEnd()))
    const f = facade(source)
    const events = collect(f)

    await f.prompt('统计三班人数')
    expect(f.isIdle).toBe(false)
    await f.waitForIdle()

    expect(events.map((e) => e.type)).toEqual([
      'message_update',
      'message_update',
      'turn_end',
      'agent_end',
    ])
    expect(seen[0].systemPrompt).toBe('你是班主任助手')
    expect(seen[0].providerId).toBe('deepseek')
    expect(seen[0].modelId).toBe('deepseek-v4-flash')
    expect(seen[0].blocks).toEqual([{ type: 'text', text: '统计三班人数' }])
  })

  it('waitForIdle 未忙时立即 resolve，可重复 await', async () => {
    const { source } = sourceFactory(() => of(turnEnd()))
    const f = facade(source)
    await expect(f.waitForIdle()).resolves.toBeUndefined()
    await f.prompt('x')
    await f.waitForIdle()
    await expect(f.waitForIdle()).resolves.toBeUndefined()
  })

  it('写入 state.messages 后，历史以文本前缀随下一次 prompt 带过去', async () => {
    const { source, seen } = sourceFactory(() => of(turnEnd()))
    const f = facade(source)
    f.state.messages = [
      { role: 'user', content: '上周说过要查重', timestamp: 1 } as never,
      { role: 'assistant', content: '好的', timestamp: 2 } as never,
    ]
    await f.prompt('继续')
    await f.waitForIdle()
    expect(firstText(seen[0])).toBe('user: 上周说过要查重\nassistant: 好的\n继续')
  })

  it('无 content 的成员（BashExecutionMessage 等）不打断历史渲染', async () => {
    const { source, seen } = sourceFactory(() => of(turnEnd()))
    const f = facade(source)
    f.state.messages = [
      { role: 'bashExecution' } as never,
      { role: 'user', content: '在', timestamp: 1 } as never,
    ]
    await f.prompt('问')
    await f.waitForIdle()
    expect(firstText(seen[0])).toBe('user: 在\n问')
  })

  it('上一轮未结束就再次 prompt 明确抛错', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { source } = sourceFactory(() => gated(gate, turnEnd()))
    const f = facade(source)
    await f.prompt('第一轮')
    expect(f.isIdle).toBe(false)
    await expect(f.prompt('插队')).rejects.toThrow(/上一轮/)
    release()
    await f.waitForIdle()
    expect(f.isIdle).toBe(true)
  })

  it('abort 关子进程、唤醒等待者，之后的 prompt 明确失败', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { source, disposedOf } = sourceFactory(() => gated(gate, turnEnd()))
    const f = facade(source)
    await f.prompt('x')
    const idle = f.waitForIdle()
    await f.abort()
    await expect(idle).resolves.toBeUndefined()
    expect(disposedOf()).toBe(1)
    await expect(f.prompt('再来')).rejects.toThrow(/已关闭/)
    release()
  })

  it('事件源抛错时标记 failed、补发收尾事件并释放 idle', async () => {
    const { source } = sourceFactory(() => of(), new Error('runtime died'))
    const f = facade(source)
    const events = collect(f)
    await f.prompt('x')
    await f.waitForIdle()
    expect(f.outcome).toEqual({ aborted: false, failed: true })
    // pi 路径的每一轮都以这一对结束，collector 的 turnCount 挂在 turn_end 上
    expect(events.map((e) => e.type)).toEqual(['turn_end', 'agent_end'])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('turn 中断'),
      expect.stringContaining('runtime died'),
    )
  })

  it('abort 打断在跑的轮次：记 aborted（不是 failed）且补发 turn_end + agent_end', async () => {
    // 真实链路上 abort 会关子进程，于是正在等的流以抛错收尾（见 e2e 探针）
    let kill: (err: Error) => void = () => {}
    const source: DshTurnSource = {
      async *turnEvents() {
        await new Promise<void>((_resolve, reject) => {
          kill = reject
        })
        yield turnEnd()
      },
      async dispose() {
        kill(new Error('transport closed'))
      },
    }
    const f = facade(source)
    const events = collect(f)
    await f.prompt('x')
    const idle = f.waitForIdle()
    await f.abort()
    await idle
    expect(f.outcome).toEqual({ aborted: true, failed: false })
    expect(events.map((e) => e.type)).toEqual(['turn_end', 'agent_end'])
    expect(f.isIdle).toBe(true)
  })

  it('aborted 轮次记在 outcome 上', async () => {
    const { source } = sourceFactory(() => of(assistant(['半句']), turnEnd('aborted')))
    const f = facade(source)
    await f.prompt('x')
    await f.waitForIdle()
    expect(f.outcome).toEqual({ aborted: true, failed: false })
  })

  it('unsubscribe 后不再收到事件', async () => {
    const { source } = sourceFactory(() => of(assistant(['a']), turnEnd()))
    const f = facade(source)
    const events: AgentEvent[] = []
    f.subscribe((e) => events.push(e))()
    await f.prompt('x')
    await f.waitForIdle()
    expect(events).toHaveLength(0)
  })

  it('给了 toolNameMap 时，system prompt 里的裸工具名被改写为用户消息不动', async () => {
    const { source, seen } = sourceFactory(() => of(turnEnd()))
    const f = new DshAgentFacade({
      runtime: source,
      model,
      systemPrompt: '先调用 class_list 查班级，再 class_create 建班',
      toolNameMap: { class_list: 'mcp__eaa__class_list', class_create: 'mcp__eaa__class_create' },
    })
    await f.prompt('请用 class_list 帮我查一下')
    await f.waitForIdle()

    expect(seen[0].systemPrompt).toBe(
      '先调用 mcp__eaa__class_list 查班级，再 mcp__eaa__class_create 建班',
    )
    // 用户消息可能含学生/作业正文，不做替换
    expect(firstText(seen[0])).toBe('请用 class_list 帮我查一下')
  })

  it('createDshAgent 给出可用的替身：工具面由挂载阶段决定，这里不再拒绝', async () => {
    const { source, seen } = sourceFactory(() => of(assistant(['好']), turnEnd()))
    const f = createDshAgent({ runtime: source, model, systemPrompt: 's' })
    expect(f).toBeInstanceOf(DshAgentFacade)

    const events = collect(f)
    await f.prompt('x')
    await f.waitForIdle()

    expect(seen).toHaveLength(1)
    expect(events.map((e) => e.type)).toContain('agent_end')
  })
})

describe('图文历史（agent 链路的视觉通道）', () => {
  it('历史里的图片块随本轮一起发出，不再只剩文本标记', async () => {
    const { source, seen } = sourceFactory(() => of(turnEnd()))
    const f = facade(source)
    f.state.messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张卷子' },
          { type: 'image', data: 'PNG1', mimeType: 'image/png' },
        ],
      },
      { role: 'toolResult', content: [{ type: 'image', data: 'JPG2', mimeType: 'image/jpeg' }] },
    ] as never
    await f.prompt('第二张的第三题呢')
    await f.waitForIdle()
    expect(seen[0].blocks).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('[image image/png]'),
      },
      { type: 'text', text: expect.stringContaining('共 2 张') },
      { type: 'image', data: 'PNG1', mimeType: 'image/png' },
      { type: 'image', data: 'JPG2', mimeType: 'image/jpeg' },
    ])
  })

  it('dsh 不受理的 mime 只留文字标记，不塞进图片块', async () => {
    const { source, seen } = sourceFactory(() => of(turnEnd()))
    const f = facade(source)
    f.state.messages = [
      { role: 'user', content: [{ type: 'image', data: 'BMP', mimeType: 'image/bmp' }] },
    ] as never
    await f.prompt('这张bmp写的啥')
    await f.waitForIdle()
    expect(seen[0].blocks).toEqual([
      { type: 'text', text: expect.stringContaining('[image image/bmp]') },
    ])
  })
})
