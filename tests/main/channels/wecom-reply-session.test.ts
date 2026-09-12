// =============================================================
// 企微 respond-stream 回复会话 — 行为锚定:
//   创建即发占位首帧(秒回)/ 节流全量帧 / finalize·fail 终帧幂等 /
//   req_id 透传 / 10 分钟硬窗口守卫强制收尾
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import { createWecomReplySession } from '../../../src/main/services/channels/adapters/wecom/reply-session'

/** 解析 sendCommand 记录为可断言形状 */
function sentFrames(sends: Array<Record<string, unknown>>) {
  return sends.map((args) => ({
    cmd: args.cmd as string,
    reqId: args.reqId as string,
    stream: (args.body as { stream?: { id: string; finish: boolean; content: string } }).stream,
  }))
}

describe('createWecomReplySession', () => {
  let sends: Array<Record<string, unknown>>

  beforeEach(() => {
    vi.useFakeTimers()
    sends = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeSession(placeholder = '正在思考…') {
    const sendCommand = vi.fn((cmd: string, reqId: string, body: Record<string, unknown>) => {
      sends.push({ cmd, reqId, body })
    })
    const session = createWecomReplySession({ sendCommand, reqId: 'cb_req_42' }, placeholder)
    return { session, sendCommand }
  }

  async function flush(): Promise<void> {
    // 发送链是微任务串行 — 0ms 推进同时冲刷微任务队列
    await vi.advanceTimersByTimeAsync(0)
  }

  it('创建即发占位首帧(finish=false),req_id 透传,stream.id 稳定', async () => {
    const { session } = makeSession()
    await flush()
    expect(sends).toHaveLength(1)
    const [f] = sentFrames(sends)
    expect(f).toMatchObject({
      cmd: 'aibot_respond_msg',
      reqId: 'cb_req_42',
      stream: { finish: false, content: '正在思考…' },
    })
    const id = f.stream.id
    expect(id).toBeTruthy()
    // 后续帧同 id
    await session.update('第一段')
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(sentFrames(sends).every((x) => x.stream.id === id)).toBe(true)
  })

  it('update 节流: 900ms 窗口内多次 update 合并为最后一帧全量文本', async () => {
    const { session } = makeSession()
    await flush()
    await session.update('片段A')
    await session.update('片段A片段B')
    await session.update('片段A片段B片段C')
    await vi.advanceTimersByTimeAsync(900)
    await flush()
    const frames = sentFrames(sends).filter((f) => !f.stream.finish)
    expect(frames).toHaveLength(2) // 占位 + 1 个合并帧
    expect(frames[1].stream.content).toBe('片段A片段B片段C')
  })

  it('finalize: 终帧 finish=true 带全文;此后 update/finalize 均无效', async () => {
    const { session } = makeSession()
    await flush()
    await session.update('中间态')
    await vi.advanceTimersByTimeAsync(900)
    await session.finalize('这是最终答案')
    await flush()
    const finishFrames = sentFrames(sends).filter((f) => f.stream.finish)
    expect(finishFrames).toHaveLength(1)
    expect(finishFrames[0].stream.content).toBe('这是最终答案')

    await session.update('迟到的更新')
    await session.finalize('二次收尾')
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(sentFrames(sends).filter((f) => f.stream.finish)).toHaveLength(1)
  })

  it('fail: 终帧带错误文本且 finish=true', async () => {
    const { session } = makeSession()
    await flush()
    await session.fail('处理出错:超时')
    await flush()
    const [f] = sentFrames(sends).filter((x) => x.stream.finish)
    expect(f.stream.content).toBe('处理出错:超时')
  })

  it('finalize 空文本 → 占位 "(完成)" 不发空帧', async () => {
    const { session } = makeSession()
    await flush()
    await session.finalize('')
    await flush()
    const [f] = sentFrames(sends).filter((x) => x.stream.finish)
    expect(f.stream.content).toBe('(完成)')
  })

  it('10 分钟硬窗口守卫: 9.5 分钟时强制收尾并追加截断说明', async () => {
    const { session } = makeSession()
    await flush()
    await session.update('一直在生成的内容')
    await vi.advanceTimersByTimeAsync(900)
    // 推进到守卫触发(STREAM_WINDOW_MS - GUARD = 9.5min,从创建起算)
    await vi.advanceTimersByTimeAsync(9.5 * 60 * 1000)
    await flush()
    const finishFrames = sentFrames(sends).filter((f) => f.stream.finish)
    expect(finishFrames).toHaveLength(1)
    expect(finishFrames[0].stream.content).toMatch(/一直在生成的内容/)
    expect(finishFrames[0].stream.content).toMatch(/10 分钟上限/)
    // 守卫后一切操作无效
    await session.finalize('不再生效')
    await flush()
    expect(sentFrames(sends).filter((f) => f.stream.finish)).toHaveLength(1)
  })
})
