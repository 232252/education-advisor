// =============================================================
// DshRuntime 原生多轮会话（resumeSession）
//
// 锁定版 SDK 的 session/prompt 对未知 id 惰性建会话、历史由 dsh 持久化。
// 给运行时一个稳定会话键后：同进程多轮复用同一 sessionId（dsh 持有上下文），
// 新进程首轮先 resumeSession 恢复历史；恢复失败回退「文本前缀」老路径，
// 保证任何情况下对话不中断。无会话键的调用方行为逐字不变。
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
  sessionIds: string[]
  resumed: string[]
  promptBlocks: unknown[]
}

function makeClient(opts: { resumeFails?: boolean; rec: Rec }): DshClientLike {
  let sub: FakeSubscription | null = null
  return {
    async initialize() {
      return {}
    },
    async resumeSession(sessionId: string) {
      opts.rec.resumed.push(sessionId)
      if (opts.resumeFails) throw new Error('session not found')
    },
    prompt(sessionId, blocks) {
      opts.rec.sessionIds.push(sessionId)
      opts.rec.promptBlocks.push(blocks)
      // 惰性建会话：prompt 受理后回一个 turn/end 收尾
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
    subscribe(filter) {
      sub = new FakeSubscription(filter)
      return sub
    },
    async close() {},
  }
}

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* 消费到结束 */
  }
}

const turn = (runtime: DshRuntime, content: string, sessionKey?: string) =>
  runtime.chatStream({
    providerId: 'p',
    modelId: 'm',
    messages: [{ role: 'user', content }],
    ...(sessionKey ? { sessionKey } : {}),
  })

describe('DshRuntime 原生多轮会话', () => {
  it('同一会话键的多轮复用同一 sessionId，且只在新进程首轮 resume', async () => {
    const rec: Rec = { sessionIds: [], resumed: [], promptBlocks: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec }),
    })
    await drain(turn(rt, '第一句', 'agent-main'))
    await drain(turn(rt, '第二句', 'agent-main'))
    expect(rec.sessionIds[0]).toBe(rec.sessionIds[1])
    expect(rec.sessionIds[0]).toContain('agent-main')
    // 同进程第二轮 dsh 已持有会话，不再 resume
    expect(rec.resumed).toEqual([rec.sessionIds[0]])
  })

  it('新进程的首轮先 resumeSession 恢复历史', async () => {
    const rec1: Rec = { sessionIds: [], resumed: [], promptBlocks: [] }
    const rt1 = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec: rec1 }),
    })
    await drain(turn(rt1, '第一句', 'agent-main'))
    const stableId = rec1.sessionIds[0]

    // 模拟换模型/重启：新运行时、同一会话键
    const rec2: Rec = { sessionIds: [], resumed: [], promptBlocks: [] }
    const rt2 = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec: rec2 }),
    })
    await drain(turn(rt2, '第二句', 'agent-main'))
    expect(rec2.resumed).toEqual([stableId])
    expect(rec2.sessionIds).toEqual([stableId])
  })

  it('resume 失败时回退文本前缀，对话不中断', async () => {
    const rec: Rec = { sessionIds: [], resumed: [], promptBlocks: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ resumeFails: true, rec }),
    })
    await drain(
      rt.chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [
          { role: 'user', content: '旧问题' },
          { role: 'assistant', content: '旧回答' },
          { role: 'user', content: '新问题' },
        ],
        sessionKey: 'agent-main',
      }),
    )
    expect(rec.resumed.length).toBe(1)
    expect(rec.promptBlocks[0]).toEqual([
      { type: 'text', text: 'user: 旧问题\nassistant: 旧回答\nuser: 新问题' },
    ])
  })

  it('无会话键时行为不变：每轮新 id、不 resume、历史走文本前缀', async () => {
    const rec: Rec = { sessionIds: [], resumed: [], promptBlocks: [] }
    const rt = new DshRuntime({
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      createClient: async () => makeClient({ rec }),
    })
    await drain(turn(rt, '甲'))
    await drain(turn(rt, '乙'))
    expect(rec.sessionIds[0]).not.toBe(rec.sessionIds[1])
    expect(rec.resumed).toEqual([])
  })
})
