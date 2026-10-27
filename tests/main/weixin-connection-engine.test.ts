// =============================================================
// weixinBotService — iLink 长轮询引擎测试
// 真 ChatMessageQueue/parsing/persist + 假 ILinkClient/pipeline hooks。
// 覆盖: 空凭证防呆、游标持久化、消息入队、去重、队列满回繁忙、
// ret≠0/-1 停顿、401 凭证失效停轮、超时续轮、通用错误退避重试、
// stop 语义与 pushText 弱主动。
// =============================================================

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  sendText: vi.fn(async () => {}),
  onPlaceholder: vi.fn(),
  onBatch: vi.fn(async () => {}),
  onDrop: vi.fn(async () => {}),
  // 模块加载期(utils/log/rotation 顶层)就会被调用,须有默认实现
  getPath: vi.fn((n: string) => join(tmpdir(), 'wx-engine-default', n)),
  runAgentStreaming: vi.fn(),
}))

let userDataDir = ''

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
}))
vi.mock('../../src/main/services/channels/adapters/weixin/ilink-client', () => ({
  ILinkClient: class {
    getUpdates = mocks.getUpdates
    sendText = mocks.sendText
  },
}))
vi.mock('../../src/main/services/channels/bridge/pipeline', () => ({
  createChannelPipeline: () => ({
    onPlaceholder: mocks.onPlaceholder,
    onBatch: mocks.onBatch,
    onDrop: mocks.onDrop,
  }),
}))
vi.mock('../../src/main/services/channels/bridge/agent-runner', () => ({
  runAgentStreaming: mocks.runAgentStreaming,
}))
vi.mock('../../src/main/services/channels/bridge/command-context', () => ({
  createCommandContext: () => ({}),
}))
vi.mock('../../src/main/services/channels/adapters/weixin/reply-session', () => ({
  createWeixinReplySession: () => ({ fail: vi.fn(async () => {}) }),
}))

import { weixinBotService } from '../../src/main/services/channels/adapters/weixin/connection'

function userMsg(id: string, userId: string, text: string, contextToken = 'ctx') {
  return {
    message_type: 1,
    from_user_id: userId,
    context_token: contextToken,
    msg_id: id,
    item_list: [{ type: 1, text_item: { text } }],
  }
}

/** 停住长轮询的 getupdates(挂起 Promise) */
function park() {
  mocks.getUpdates.mockReturnValue(new Promise(() => {}))
}

describe('weixinBotService 长轮询引擎', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userDataDir = mkdtempSync(join(tmpdir(), 'wx-engine-'))
    mocks.getPath.mockImplementation((n: string) =>
      n === 'userData' ? userDataDir : join(userDataDir, n),
    )
    mocks.onBatch.mockImplementation(async () => {})
    mocks.onPlaceholder.mockResolvedValue(null)
    mocks.sendText.mockResolvedValue(undefined)
  })
  afterEach(async () => {
    await weixinBotService.stop()
    vi.useRealTimers()
  })

  it('空 token 防呆: error 状态,不建连接', async () => {
    await weixinBotService.start('   ', null)
    expect(weixinBotService.getStatus().status).toBe('error')
    expect(weixinBotService.getStatus().error).toContain('Token')
    expect(mocks.getUpdates).not.toHaveBeenCalled()
  })

  it('消息入队: 游标落盘 + context_token 持久化 + 占位/批次送达', async () => {
    vi.useFakeTimers()
    mocks.getUpdates
      .mockResolvedValueOnce({ msgs: [userMsg('m1', 'u1@wx', '你好')], get_updates_buf: 'cur-9', ret: 0 })
      .mockImplementation(() => {
        park()
        return new Promise(() => {})
      })
    await weixinBotService.start('tok', null)
    expect(weixinBotService.getStatus().status).toBe('connected')
    await vi.advanceTimersByTimeAsync(0)
    // 游标与 context_token 已在首轮回询后落盘
    expect(readFileSync(join(userDataDir, 'channels/weixin/state/cursor.txt'), 'utf8')).toBe('cur-9')
    const ctx = JSON.parse(
      readFileSync(join(userDataDir, 'channels/weixin/state/context_tokens.json'), 'utf8'),
    )
    expect(ctx['u1@wx']).toBe('ctx')
    // 合并窗口(2s)冲刷后进入处理
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(1)
    expect(mocks.onPlaceholder.mock.calls[0][0].parsed).toMatchObject({
      messageId: 'm1',
      chatId: 'u1@wx',
      text: '你好',
    })
    expect(mocks.onBatch).toHaveBeenCalledTimes(1)
    expect(mocks.getUpdates).toHaveBeenCalledTimes(2)
  })

  it('同 msg_id 重复投递被去重,只入队一次', async () => {
    vi.useFakeTimers()
    const dup = userMsg('dup-1', 'u1@wx', '只来一次')
    mocks.getUpdates
      .mockResolvedValueOnce({ msgs: [dup], get_updates_buf: 'c1', ret: 0 })
      .mockResolvedValueOnce({ msgs: [{ ...dup }], get_updates_buf: 'c2', ret: 0 })
      .mockImplementation(() => {
        park()
        return new Promise(() => {})
      })
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(1)
  })

  it('队列满(16 上限)第 17 条回繁忙提示', async () => {
    vi.useFakeTimers()
    // 批处理挂起 → pending 不消化
    mocks.onBatch.mockImplementation(() => new Promise(() => {}))
    const msgs = Array.from({ length: 17 }, (_, i) => userMsg('f' + i, 'u' + i + '@wx', 'm' + i))
    mocks.getUpdates.mockResolvedValueOnce({ msgs, get_updates_buf: 'c1', ret: 0 })
    park2After()
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(2100)
    // 前 16 条各建占位(不同 chatId 并行),第 17 条回繁忙
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(16)
    expect(mocks.sendText).toHaveBeenCalledWith(
      'u16@wx',
      expect.stringContaining('繁忙'),
      'ctx',
    )
  })

  it('ret 非 0/-1 且无消息: 暂停 3s 后续轮', async () => {
    vi.useFakeTimers()
    mocks.getUpdates.mockResolvedValueOnce({ msgs: [], get_updates_buf: 'c1', ret: 5 })
    park2After()
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.getUpdates).toHaveBeenCalledTimes(2)
  })

  it('401 凭证失效: error 状态并停止轮询', async () => {
    vi.useFakeTimers()
    mocks.getUpdates.mockRejectedValueOnce(new Error('401 unauthorized'))
    park2After()
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(50)
    const st = weixinBotService.getStatus()
    expect(st.status).toBe('error')
    expect(st.error).toContain('凭证失效')
    expect(mocks.getUpdates).toHaveBeenCalledTimes(1)
  })

  it('超时/中断: 静默续轮;通用错误: 退避 1s 后重试', async () => {
    vi.useFakeTimers()
    mocks.getUpdates
      .mockRejectedValueOnce(new Error('TimeoutError'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockImplementation(() => {
        park()
        return new Promise(() => {})
      })
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(0)
    // 超时立即续轮(第 2 次),ECONNRESET 进入 1s 退避
    expect(mocks.getUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.getUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(600)
    expect(mocks.getUpdates).toHaveBeenCalledTimes(3)
    expect(weixinBotService.getStatus().reconnectAttempt).toBe(1)
  })

  it('stop: 状态归 idle,游标保存;pushText 防呆', async () => {
    vi.useFakeTimers()
    mocks.getUpdates
      .mockResolvedValueOnce({ msgs: [userMsg('m1', 'u1@wx', 'hi')], get_updates_buf: 'cur-z', ret: 0 })
      .mockImplementation(() => {
        park()
        return new Promise(() => {})
      })
    await weixinBotService.start('tok', null)
    await vi.advanceTimersByTimeAsync(0)
    // 弱主动推送: 有 context_token 即可发送
    await weixinBotService.pushText('u1@wx', '主动问候')
    expect(mocks.sendText).toHaveBeenCalledWith('u1@wx', '主动问候', 'ctx')

    await weixinBotService.stop()
    expect(weixinBotService.getStatus().status).toBe('idle')
    expect(readFileSync(join(userDataDir, 'channels/weixin/state/cursor.txt'), 'utf8')).toBe('cur-z')
    await expect(weixinBotService.pushText('u1@wx', 'x')).rejects.toThrow('微信未连接')
    // 无 token 用户防呆
    await weixinBotService.start('tok', null)
    mocks.getUpdates
      .mockResolvedValueOnce({ msgs: [], get_updates_buf: '', ret: 0 })
      .mockImplementation(() => {
        park()
        return new Promise(() => {})
      })
    await vi.advanceTimersByTimeAsync(0)
    await expect(weixinBotService.pushText('nobody@wx', 'x')).rejects.toThrow('context_token')
  })
})

/** 之后的 getupdates 全部挂起(mockResolvedValueOnce 队列优先消费首调) */
function park2After() {
  mocks.getUpdates.mockImplementation(() => new Promise(() => {}))
}