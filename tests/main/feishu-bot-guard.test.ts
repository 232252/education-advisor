// =============================================================
// FeishuBotService — H1/H2/H3/M1/M2/M3 修复专项测试
//   H1: appId 格式预检 + 凭证显式鉴权(防"假连接")
//   H2: reply 检查飞书业务返回码
//   H3: 事件回调不阻塞 ack + message_id 去重 + 排队上限
//   M1/M4: failed 态守护重启(指数退避)
//   M2: 系统休眠唤醒强制重连
//   M3: 内部 stop 不污染 userStopped
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  wsInstances: [] as Array<{
    start: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    getConnectionStatus: ReturnType<typeof vi.fn>
  }>,
  wsState: 'connected',
  registeredHandles: null as Record<string, (data: unknown) => unknown> | null,
  replyMock: vi.fn(),
  resumeHandlers: [] as Array<() => void>,
  dispatchMock: vi.fn(),
}))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  WSClient: class {
    start = vi.fn(() => Promise.resolve())
    close = vi.fn()
    getConnectionStatus = vi.fn(() => ({ state: mocks.wsState, reconnectAttempts: 0 }))
    constructor() {
      mocks.wsInstances.push(this)
    }
  },
  Client: class {
    im = { message: { reply: mocks.replyMock } }
  },
  EventDispatcher: class {
    register(handles: Record<string, (data: unknown) => unknown>) {
      mocks.registeredHandles = handles
      return this
    }
  },
  AppType: { SelfBuild: 1 },
  Domain: { Feishu: 'https://open.feishu.cn' },
  LoggerLevel: { warn: 2, debug: 0, info: 1, error: 3 },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
  powerMonitor: {
    on: vi.fn((_event: string, cb: () => void) => mocks.resumeHandlers.push(cb)),
    removeListener: vi.fn(),
  },
}))
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))
vi.mock('../../src/main/services/agent-service', () => ({
  agentService: {
    listAgents: () => [],
    runAgent: vi.fn(),
    getHistory: () => [],
  },
}))
vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { execute: vi.fn() },
  getErrorMessage: vi.fn((r: { stderr?: string }) => r?.stderr ?? 'error'),
}))
vi.mock('../../src/main/services/feishu-bot/command-router', () => ({
  createDefaultRouter: () => ({ dispatch: mocks.dispatchMock }),
  CommandContext: {},
}))

import { feishuBotService } from '../../src/main/services/feishu-bot-service'

const VALID_APP_ID = `cli_${'a'.repeat(16)}`

function mockFetchCode(code: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ code, msg: code === 0 ? 'ok' : 'invalid app_secret' }),
      }),
    ),
  )
}

function makeTextEvent(messageId: string, text = 'hi') {
  return {
    message: {
      message_id: messageId,
      chat_id: 'oc_test',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text }),
    },
    sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
  }
}

beforeEach(() => {
  mocks.wsInstances = []
  mocks.wsState = 'connected'
  mocks.registeredHandles = null
  mocks.resumeHandlers = []
  mocks.replyMock.mockReset().mockResolvedValue({ code: 0, msg: 'ok' })
  mocks.dispatchMock.mockReset().mockResolvedValue('ok')
  mockFetchCode(0)
})

afterEach(async () => {
  await feishuBotService.stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('H1: appId 格式预检 + 凭证显式鉴权', () => {
  it('非法 appId 格式 → 立即 error,不创建 WSClient', async () => {
    await feishuBotService.start('not-a-valid-appid', 'secret', null)
    const s = feishuBotService.getStatus()
    expect(s.status).toBe('error')
    expect(s.error).toContain('App ID 格式不正确')
    expect(mocks.wsInstances.length).toBe(0)
  })

  it('凭证校验失败(code≠0) → error,不创建 WSClient', async () => {
    mockFetchCode(999)
    await feishuBotService.start(VALID_APP_ID, 'bad-secret', null)
    const s = feishuBotService.getStatus()
    expect(s.status).toBe('error')
    expect(s.error).toContain('校验失败')
    expect(mocks.wsInstances.length).toBe(0)
  })

  it('凭证校验请求抛错(网络不可达) → error,不创建 WSClient', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const s = feishuBotService.getStatus()
    expect(s.status).toBe('error')
    expect(s.error).toContain('凭证校验请求失败')
    expect(mocks.wsInstances.length).toBe(0)
  })

  it('凭证有效 → 创建 WSClient 并 start,状态 connecting', async () => {
    mocks.wsState = 'connecting'
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    expect(mocks.wsInstances.length).toBe(1)
    expect(mocks.wsInstances[0].start).toHaveBeenCalledTimes(1)
    expect(feishuBotService.getStatus().status).toBe('connecting')
  })
})

describe('M3: 内部 stop 不污染 userStopped', () => {
  it('stop({userInitiated:false}) 不置位 userStopped', async () => {
    // start 会清除标志(确保起点为 false)
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    expect(feishuBotService.isUserStopped()).toBe(false)
    await feishuBotService.stop({ userInitiated: false })
    expect(feishuBotService.isUserStopped()).toBe(false)
  })

  it('stop() 默认置位 userStopped', async () => {
    await feishuBotService.stop()
    expect(feishuBotService.isUserStopped()).toBe(true)
  })

  it('start 内部重启后 userStopped 被清除(保存新凭证可自动重连)', async () => {
    // 先连上
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    expect(mocks.wsInstances.length).toBe(1)
    // 模拟用户手动停止
    await feishuBotService.stop()
    expect(feishuBotService.isUserStopped()).toBe(true)
    // 保存新凭证触发 start(内部 stop + 清除标志)
    await feishuBotService.start(`cli_${'b'.repeat(16)}`, 'secret', null)
    expect(feishuBotService.isUserStopped()).toBe(false)
    expect(mocks.wsInstances.length).toBe(2)
  })
})

describe('H3: 事件不阻塞 ack + 去重 + 队列上限', () => {
  it('事件回调同步返回(不等待消息处理完成)', async () => {
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const handler = mocks.registeredHandles?.['im.message.receive_v1']
    expect(handler).toBeDefined()
    // dispatch 挂起 → 若回调 await 处理,返回值 promise 不会立刻 settle
    let resolveDispatch!: (v: string) => void
    mocks.dispatchMock.mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolveDispatch = r
        }),
    )
    const ret = handler!(makeTextEvent('mid_h3_1'))
    // 回调应返回 undefined(同步路径,未 await 队列)
    expect(ret).toBeUndefined()
    // 等队列消化到 dispatch(异步)
    await vi.waitFor(() => expect(mocks.dispatchMock).toHaveBeenCalledTimes(1))
    resolveDispatch('ok')
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.dispatchMock).toHaveBeenCalledTimes(1)
  })

  it('相同 message_id 重投 → 去重跳过,只处理一次', async () => {
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const handler = mocks.registeredHandles?.['im.message.receive_v1']
    handler!(makeTextEvent('mid_dup_1'))
    handler!(makeTextEvent('mid_dup_1'))
    handler!(makeTextEvent('mid_dup_1'))
    await vi.waitFor(() => expect(mocks.dispatchMock).toHaveBeenCalledTimes(1))
    // 再多等一拍,确认没有第 2 次处理
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.dispatchMock).toHaveBeenCalledTimes(1)
  })

  it('排队超过 16 条 → 多余消息丢弃并回复"繁忙"', async () => {
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const handler = mocks.registeredHandles?.['im.message.receive_v1']
    // 第一条挂起,占住串行队列
    let resolveDispatch!: (v: string) => void
    mocks.dispatchMock.mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolveDispatch = r
        }),
    )
    handler!(makeTextEvent('mid_full_0'))
    // 等第一条进入 dispatch(占住处理位)
    await vi.waitFor(() => expect(mocks.dispatchMock).toHaveBeenCalledTimes(1))
    // 再投 16 条填满 pending(处理中1 + 排队15 = 16)
    for (let i = 1; i <= 16; i++) {
      handler!(makeTextEvent(`mid_full_${i}`))
    }
    // 第 17 条应被丢弃并触发"繁忙"回复
    mocks.replyMock.mockClear()
    handler!(makeTextEvent('mid_full_overflow'))
    expect(mocks.replyMock).toHaveBeenCalledTimes(1)
    const replyContent = JSON.parse(
      (mocks.replyMock.mock.calls[0][0] as { data: { content: string } }).data.content,
    ) as { text: string }
    expect(replyContent.text).toContain('繁忙')

    // 放行: 后续 15 条排队消息立即 resolve,避免悬挂队列污染后续测试
    mocks.dispatchMock.mockImplementation(() => Promise.resolve('ok'))
    resolveDispatch('ok')
    await new Promise((r) => setTimeout(r, 50))
  })
})

describe('M1/M4: failed 态守护重启', () => {
  it('轮询发现 failed → 自动 close + start 重启', async () => {
    vi.useFakeTimers()
    try {
      await feishuBotService.start(VALID_APP_ID, 'secret', null)
      expect(mocks.wsInstances.length).toBe(1)
      const inst = mocks.wsInstances[0]
      expect(inst.start).toHaveBeenCalledTimes(1)

      // SDK 重试耗尽进入 failed
      mocks.wsState = 'failed'
      await vi.advanceTimersByTimeAsync(3100)

      // 守护已触发重启: close(force) + 再次 start
      expect(inst.close).toHaveBeenCalledWith({ force: true })
      expect(inst.start).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('userStopped 时 failed 不触发守护重启', async () => {
    vi.useFakeTimers()
    try {
      await feishuBotService.start(VALID_APP_ID, 'secret', null)
      const inst = mocks.wsInstances[0]
      await feishuBotService.stop() // stopStatusPolling + userStopped
      mocks.wsState = 'failed'
      await vi.advanceTimersByTimeAsync(10_000)
      expect(inst.start).toHaveBeenCalledTimes(1) // 无重启
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M2: 系统休眠唤醒强制重连', () => {
  it('powerMonitor resume → close + start 重建连接', async () => {
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const inst = mocks.wsInstances[0]
    expect(inst.start).toHaveBeenCalledTimes(1)
    expect(mocks.resumeHandlers.length).toBe(1)

    // 模拟系统从休眠唤醒
    mocks.resumeHandlers[0]()
    await new Promise((r) => setTimeout(r, 10))
    expect(inst.close).toHaveBeenCalledWith({ force: true })
    expect(inst.start).toHaveBeenCalledTimes(2)
  })

  it('userStopped 后 resume 不触发重连', async () => {
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const inst = mocks.wsInstances[0]
    await feishuBotService.stop()
    mocks.resumeHandlers[0]?.()
    await new Promise((r) => setTimeout(r, 10))
    expect(inst.start).toHaveBeenCalledTimes(1)
  })
})

describe('H2: reply 检查飞书业务返回码', () => {
  it('reply 返回 code≠0 → 记 error 日志而非"reply sent"', async () => {
    const { log } = await import('../../src/main/utils/logger')
    const logMock = vi.mocked(log)
    logMock.mockClear()

    mocks.replyMock.mockResolvedValue({ code: 230002, msg: 'message expired' })
    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const handler = mocks.registeredHandles?.['im.message.receive_v1']
    mocks.dispatchMock.mockResolvedValue('pong')
    handler!(makeTextEvent('mid_h2_1'))
    await new Promise((r) => setTimeout(r, 20))

    const errorCalls = logMock.mock.calls.filter(
      ([level, , msg]) => level === 'error' && String(msg).includes('reply rejected'),
    )
    expect(errorCalls.length).toBe(1)
    expect(String(errorCalls[0][2])).toContain('230002')
  })

  it('reply 返回 code=0 → 记"reply sent"', async () => {
    const { log } = await import('../../src/main/utils/logger')
    const logMock = vi.mocked(log)
    logMock.mockClear()

    await feishuBotService.start(VALID_APP_ID, 'secret', null)
    const handler = mocks.registeredHandles?.['im.message.receive_v1']
    mocks.dispatchMock.mockResolvedValue('pong')
    handler!(makeTextEvent('mid_h2_2'))
    await new Promise((r) => setTimeout(r, 20))

    const sentCalls = logMock.mock.calls.filter(
      ([, , msg]) => String(msg).includes('reply sent'),
    )
    expect(sentCalls.length).toBe(1)
  })
})
