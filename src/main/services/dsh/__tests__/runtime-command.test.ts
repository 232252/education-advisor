// =============================================================
// DshRuntime 斜杠指令路由（session/query）
//
// 指令输入不走 session/prompt，而走 session/query（DSH 原生 prompt-or-command
// 路由）。纯状态指令（compact/permission）不产生模型 turn，靠
// session.query.completed 通知收尾；指令启动的模型工作（goal/plan）仍有 turn/end。
// 普通对话（command 未置位）行为逐字不变。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { DshClientLike, DshNotification, DshSubscriptionLike } from '../runtime'
import { DshRuntime } from '../runtime'

class FakeSubscription implements DshSubscriptionLike {
  private readonly queued: DshNotification[] = []
  private readonly waiters: { res: (n: DshNotification) => void; rej: (e: Error) => void }[] = []
  private closed = false
  constructor(private readonly filter: (n: DshNotification) => boolean) {}
  deliver(n: DshNotification): void {
    if (this.closed || !this.filter(n)) return
    const w = this.waiters.shift()
    if (w) w.res(n)
    else this.queued.push(n)
  }
  next(): Promise<DshNotification> {
    const item = this.queued.shift()
    if (item) return Promise.resolve(item)
    if (this.closed) return Promise.reject(new Error('subscription closed'))
    return new Promise((res, rej) => this.waiters.push({ res, rej }))
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.queued.length = 0
    for (const w of this.waiters.splice(0)) w.rej(new Error('subscription closed'))
  }
}

interface Rec {
  prompts: string[]
  queries: { sessionId: string; method: string; text: string }[]
}

/**
 * makeClient：
 * - stateOnly=true 模拟纯状态指令：query 受理后只发 session.query.completed，无 turn/end
 * - stateOnly=false 模拟指令启动模型工作：发 assistant/message + turn/end + completed
 */
function makeClient(opts: { rec: Rec; stateOnly?: boolean }): DshClientLike {
  let sub: FakeSubscription | null = null
  return {
    async initialize() {
      return {}
    },
    prompt(sessionId) {
      opts.rec.prompts.push(sessionId)
      queueMicrotask(() => {
        sub?.deliver({
          method: 'session.event',
          params: {
            sessionId,
            event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
          },
        } as unknown as DshNotification)
      })
      return Promise.resolve('msg')
    },
    async request(method: string, params?: object) {
      const p = params as { sessionId: string; contentBlocks: { type: string; text?: string }[] }
      const text = p.contentBlocks?.map((b) => b.text ?? '').join('') ?? ''
      opts.rec.queries.push({ sessionId: p.sessionId, method, text })
      queueMicrotask(() => {
        if (!opts.stateOnly) {
          sub?.deliver({
            method: 'session.event',
            params: {
              sessionId: p.sessionId,
              event: {
                type: 'assistant/message',
                data: {
                  stream: [{ type: 'text-chunks', texts: ['好的'] }],
                  usage: { inputTokens: 1, outputTokens: 1 },
                },
              },
            },
          } as unknown as DshNotification)
          sub?.deliver({
            method: 'session.event',
            params: {
              sessionId: p.sessionId,
              event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
            },
          } as unknown as DshNotification)
        }
        sub?.deliver({
          method: 'session.query.completed',
          params: {
            sessionId: p.sessionId,
            commandId: 'cmd-1',
            finalResponse: opts.stateOnly ? '已压缩' : '好的',
            finishReason: 'completed',
          },
        } as unknown as DshNotification)
      })
      return { kind: 'command', execution: { commandId: 'cmd-1', result: { kind: 'success' } } }
    },
    subscribe(filter) {
      sub = new FakeSubscription(filter)
      return sub
    },
    async close() {},
  }
}

async function collect(gen: AsyncGenerator<{ type: string }>): Promise<string[]> {
  const out: string[] = []
  for await (const e of gen) out.push(e.type)
  return out
}

const cmdTurn = (rt: DshRuntime, text: string) =>
  rt.chatStream({
    providerId: 'p',
    modelId: 'm',
    messages: [{ role: 'user', content: text }],
    sessionKey: 'agent-main',
    command: true,
  })

describe('DshRuntime 斜杠指令路由', () => {
  it('指令输入走 session/query 而非 prompt', async () => {
    const rec: Rec = { prompts: [], queries: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec, stateOnly: true }),
    })
    const types = await collect(cmdTurn(rt, '/compact'))
    expect(rec.prompts).toEqual([])
    expect(rec.queries).toHaveLength(1)
    expect(rec.queries[0].method).toBe('session/query')
    expect(rec.queries[0].text).toBe('/compact')
    expect(types).toContain('done')
  })

  it('纯状态指令无 turn/end 也能靠 completed 正常收尾', async () => {
    const rec: Rec = { prompts: [], queries: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec, stateOnly: true }),
    })
    const types = await collect(cmdTurn(rt, '/compact'))
    // 不挂起、以 done 收尾
    expect(types[types.length - 1]).toBe('done')
  })

  it('指令启动的模型工作仍透出 assistant 文本', async () => {
    const rec: Rec = { prompts: [], queries: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec, stateOnly: false }),
    })
    const events: { type: string; text?: string }[] = []
    for await (const e of cmdTurn(rt, '/goal 提高及格率')) {
      events.push(e as { type: string; text?: string })
    }
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('普通对话（command 未置位）仍走 prompt，行为不变', async () => {
    const rec: Rec = { prompts: [], queries: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec }),
    })
    await collect(
      rt.chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [{ role: 'user', content: '普通消息' }],
        sessionKey: 'agent-main',
      }),
    )
    expect(rec.queries).toEqual([])
    expect(rec.prompts).toHaveLength(1)
  })
})
