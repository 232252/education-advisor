// =============================================================
// feishu-bot 阶段 0 新模块测试
//   message-parsing — file/image/post 解析 + 群聊 @ 过滤
//   chat-queue      — 合并窗口/会话并行/命令直通/上限/cancelAll
//   recent-files    — TTL 记忆
//   reply           — 限流重试
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeishuMessageEvent } from '../../src/main/services/channels/adapters/feishu/types'

// chat-queue/reply 经 logger 依赖 electron app,vitest 环境下 mock 掉
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}))
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

// ---------- message-parsing ----------

function makeEvent(overrides: {
  type: string
  content: unknown
  chatType?: string
  mentions?: Array<{ key: string; name: string }>
}): FeishuMessageEvent {
  return {
    message: {
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: overrides.chatType ?? 'p2p',
      message_type: overrides.type,
      content: typeof overrides.content === 'string' ? overrides.content : JSON.stringify(overrides.content),
      mentions: overrides.mentions,
    },
    sender: { sender_id: { open_id: 'ou_1' }, sender_type: 'user' },
  }
}

describe('message-parsing — file/image/post(阶段 0)', () => {
  it('file 消息解析为附件(此前被静默丢弃)', async () => {
    const { parseIncomingMessage } = await import(
      '../../src/main/services/channels/adapters/feishu/parsing'
    )
    const parsed = parseIncomingMessage(
      makeEvent({ type: 'file', content: { file_key: 'fk_1', file_name: '统计表.xlsx' } }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.text).toBe('')
    expect(parsed?.attachments).toEqual([
      { kind: 'file', fileKey: 'fk_1', fileName: '统计表.xlsx' },
    ])
    expect(parsed?.chatId).toBe('oc_1')
  })

  it('image 消息解析为附件', async () => {
    const { parseIncomingMessage } = await import(
      '../../src/main/services/channels/adapters/feishu/parsing'
    )
    const parsed = parseIncomingMessage(makeEvent({ type: 'image', content: { image_key: 'img_1' } }))
    expect(parsed?.attachments).toEqual([{ kind: 'image', fileKey: 'img_1' }])
  })

  it('post 富文本提取文字段(含标题)', async () => {
    const { parseIncomingMessage } = await import(
      '../../src/main/services/channels/adapters/feishu/parsing'
    )
    const parsed = parseIncomingMessage(
      makeEvent({
        type: 'post',
        content: {
          title: '成绩说明',
          content: [
            [
              { tag: 'text', text: '这次' },
              { tag: 'a', text: '月考', href: 'https://x' },
              { tag: 'img', image_key: 'i' },
            ],
            [{ tag: 'text', text: '排名如何' }],
          ],
        },
      }),
    )
    expect(parsed?.text).toContain('成绩说明')
    expect(parsed?.text).toContain('这次月考')
    expect(parsed?.text).toContain('排名如何')
  })

  it('群聊未 @机器人 → 忽略(对所有类型生效)', async () => {
    const { parseIncomingMessage } = await import(
      '../../src/main/services/channels/adapters/feishu/parsing'
    )
    expect(
      parseIncomingMessage(makeEvent({ type: 'file', content: { file_key: 'f' }, chatType: 'group' })),
    ).toBeNull()
    expect(parseIncomingMessage(makeEvent({ type: 'text', content: { text: 'hi' }, chatType: 'group' }))).toBeNull()
  })

  it('不支持的消息类型(如 audio)返回 null', async () => {
    const { parseIncomingMessage, SUPPORTED_MESSAGE_TYPES } = await import(
      '../../src/main/services/channels/adapters/feishu/parsing'
    )
    expect(SUPPORTED_MESSAGE_TYPES.has('audio')).toBe(false)
    expect(parseIncomingMessage(makeEvent({ type: 'audio', content: { file_key: 'a' } }))).toBeNull()
  })
})

// ---------- chat-queue ----------

describe('chat-queue — 合并窗口/会话并行/命令直通(阶段 0)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeItem(chatId: string, text: string) {
    return {
      parsed: {
        text,
        messageId: `om_${chatId}_${text}`,
        chatId,
        chatType: 'p2p',
        attachments: [],
      },
    }
  }

  it('合并窗口内的连发消息合成一批', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    const batches: string[][] = []
    const q = new ChatMessageQueue({
      onPlaceholder: async () => null,
      onBatch: async (b) => {
        batches.push(b.items.map((i) => i.parsed.text))
      },
      onDrop: async () => {},
    })
    q.submit(makeItem('c1', '你好'))
    q.submit(makeItem('c1', '把表格录入'))
    await vi.advanceTimersByTimeAsync(2500)
    expect(batches).toEqual([['你好', '把表格录入']])
  })

  it('不同会话并行:会话 A 阻塞不会卡住会话 B', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    const done: string[] = []
    let releaseA!: () => void
    const gateA = new Promise<void>((r) => {
      releaseA = r
    })
    const q = new ChatMessageQueue({
      onPlaceholder: async () => null,
      onBatch: async (b) => {
        const chat = b.items[0].parsed.chatId
        if (chat === 'A') await gateA
        done.push(chat)
      },
      onDrop: async () => {},
    })
    q.submit(makeItem('A', '慢任务'))
    q.submit(makeItem('B', '快任务'))
    await vi.advanceTimersByTimeAsync(2500)
    expect(done).toEqual(['B']) // A 未放行,B 已完成
    releaseA()
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toEqual(['B', 'A'])
  })

  it('斜杠命令不等待合并窗口,立即成批', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    const order: string[] = []
    const q = new ChatMessageQueue({
      onPlaceholder: async () => null,
      onBatch: async (b) => {
        order.push(b.items[0].parsed.text)
      },
      onDrop: async () => {},
    })
    q.submit(makeItem('c1', '先想想这个问题'))
    q.submit(makeItem('c1', '/help'))
    await vi.advanceTimersByTimeAsync(0)
    // 命令触发缓冲立即冲刷:普通消息批 + 命令批都不等 2s 窗口
    expect(order).toEqual(['先想想这个问题', '/help'])
    await vi.advanceTimersByTimeAsync(2500)
    expect(order).toEqual(['先想想这个问题', '/help']) // 无新增(窗口已被命令冲掉)
  })

  it('占位回调收到排队位置(前一批未完成时为 1)', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const positions: number[] = []
    const q = new ChatMessageQueue({
      onPlaceholder: async (_i, pos) => {
        positions.push(pos)
        return null
      },
      onBatch: async (b) => {
        if (b.items[0].parsed.text === '第一批') await gate
      },
      onDrop: async () => {},
    })
    q.submit(makeItem('c1', '第一批'))
    await vi.advanceTimersByTimeAsync(2500)
    q.submit(makeItem('c1', '第二批'))
    await vi.advanceTimersByTimeAsync(10)
    expect(positions).toEqual([0, 1])
    release()
    await vi.advanceTimersByTimeAsync(2500)
  })

  it('全局 pending 上限:第 17 条 submit 返回 false', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    const q = new ChatMessageQueue({
      onPlaceholder: async () => null,
      onBatch: async () => {},
      onDrop: async () => {},
    })
    // 不推进时间(消息全部留在合并窗口,pending 累计)
    const results: boolean[] = []
    for (let i = 0; i < 17; i++) {
      results.push(q.submit(makeItem('c9', `msg${i}`)))
    }
    expect(results.slice(0, 16).every(Boolean)).toBe(true)
    expect(results[16]).toBe(false) // 第 17 条被拒
    expect(q.pendingCount).toBe(16)
    await vi.advanceTimersByTimeAsync(5000) // 冲刷干净,避免悬挂
  })

  it('cancelAll 对未处理消息回调 onDrop(含占位会话)', async () => {
    const { ChatMessageQueue } = await import('../../src/main/services/channels/runtime/chat-queue')
    const dropped: Array<{ count: number }> = []
    const fakeSession = { update: () => {}, finalize: async () => {}, fail: async () => {} }
    const q = new ChatMessageQueue({
      onPlaceholder: async () => fakeSession,
      onBatch: async () => {},
      onDrop: async (items) => {
        dropped.push({ count: items.length })
      },
    })
    q.submit(makeItem('c1', '没处理完的'))
    await vi.advanceTimersByTimeAsync(100) // 占位已发,窗口未到
    await q.cancelAll()
    expect(dropped).toEqual([{ count: 1 }])
    // 停止后新 submit 不再处理
    expect(q.submit(makeItem('c1', '停止后来消息'))).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(dropped).toEqual([{ count: 1 }])
  })
})

// ---------- recent-files ----------

describe('recent-files — 每会话最近文件记忆(阶段 0)', () => {
  it('fresh 只返回有效期内的文件,最新在前', async () => {
    const { RecentFilesStore } = await import('../../src/main/services/channels/runtime/recent-files')
    const store = new RecentFilesStore()
    const now = Date.now()
    store.note('c1', { name: 'a.xlsx', path: '/tmp/a.xlsx' }, now - 40 * 60 * 1000) // 超期
    store.note('c1', { name: 'b.xlsx', path: '/tmp/b.xlsx' }, now - 1000)
    store.note('c1', { name: 'c.xlsx', path: '/tmp/c.xlsx' }, now)
    const fresh = store.fresh('c1', now)
    expect(fresh.map((f) => f.name)).toEqual(['c.xlsx', 'b.xlsx'])
    expect(store.fresh('c2', now)).toEqual([])
  })
})

// ---------- reply 重试 ----------

describe('reply — 限流/网络错误有限重试(阶段 0)', () => {
  it('业务码 230020(限流)重试一次后成功', async () => {
    const replyMock = vi
      .fn()
      .mockResolvedValueOnce({ code: 230020, msg: 'rate limit' })
      .mockResolvedValueOnce({ code: 0, msg: 'ok' })
    const fakeClient = { im: { message: { reply: replyMock } } }
    const { sendReply } = await import('../../src/main/services/channels/adapters/feishu/reply')
    await sendReply(fakeClient as never, 'om_1', 'hi')
    expect(replyMock).toHaveBeenCalledTimes(2)
  })

  it('非限流业务码(230002)不重试', async () => {
    const replyMock = vi.fn().mockResolvedValue({ code: 230002, msg: 'expired' })
    const fakeClient = { im: { message: { reply: replyMock } } }
    const { sendReply } = await import('../../src/main/services/channels/adapters/feishu/reply')
    await sendReply(fakeClient as never, 'om_1', 'hi')
    expect(replyMock).toHaveBeenCalledTimes(1)
  })
})
