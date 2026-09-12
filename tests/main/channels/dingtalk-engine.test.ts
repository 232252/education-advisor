// =============================================================
// 钉钉引擎(connection)端到端集成 — 注入假 fetch/假 WS:
// Stream 帧 → 协议+业务双去重 → 队列 → 占位卡片 → Agent 流式 → 终稿;
// 群聊过滤、繁忙限流、stop 排空收尾。
// =============================================================

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runAgentStreaming: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\temp\\ea-test-userData'), isPackaged: false },
  powerMonitor: new EventEmitter(),
  BrowserWindow: class {},
}))

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

vi.mock('../../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      channels: { dingtalk: { enabled: true, allowGroups: true, agentId: 'main', cardTemplateId: '' } },
    })),
  },
}))

vi.mock('../../../src/main/services/channels/bridge/agent-runner', () => ({
  runAgentStreaming: mocks.runAgentStreaming,
  runAgentAndCollect: vi.fn(),
}))

vi.mock('../../../src/main/services/channels/bridge/command-context', () => ({
  createCommandContext: vi.fn(() => ({}) as unknown as Record<string, unknown>),
}))

import { dingtalkBotService } from '../../../src/main/services/channels/adapters/dingtalk/connection'
import type { WsLike } from '../../../src/main/services/channels/adapters/dingtalk/stream-client'

class FakeWs extends EventEmitter implements WsLike {
  sent: string[] = []
  closed = false
  constructor(public url: string) {
    super()
  }
  send(d: string): void {
    this.sent.push(d)
  }
  ping(): void {}
  close(): void {
    this.closed = true
  }
  off(event: string, fn: (...args: unknown[]) => void): this {
    return super.off(event, fn as never)
  }
  removeAllListeners(event?: string): this {
    return super.removeAllListeners(event)
  }
  feed(frame: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)))
  }
}

interface RecordedRequest {
  method: string
  url: string
  body: Record<string, unknown>
}

function makeFetch(requests: RecordedRequest[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    requests.push({ method: init?.method ?? 'GET', url, body })
    if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
      const okBody = { accessToken: 'tok', expireIn: 7200 }
      return {
        ok: true,
        status: 200,
        json: async () => okBody,
        text: async () => JSON.stringify(okBody),
      } as unknown as Response
    }
    if (String(url).endsWith('/v1.0/gateway/connections/open')) {
      const okBody = { endpoint: 'wss://gw.test/connect', ticket: 't-1' }
      return {
        ok: true,
        status: 200,
        json: async () => okBody,
        text: async () => JSON.stringify(okBody),
      } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response
  }
}

function textFrame(messageId: string, msgId: string, text: string, group = false): unknown {
  return {
    type: 'CALLBACK',
    headers: { topic: '/v1.0/im/bot/messages/get', messageId, contentType: 'application/json' },
    data: JSON.stringify({
      msgtype: 'text',
      msgId,
      conversationType: group ? '2' : '1',
      conversationId: 'cid-g',
      senderStaffId: 'staff-1',
      senderNick: '张老师',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
      text: { content: text },
    }),
  }
}

describe('DingtalkBotService(引擎集成)', () => {
  let requests: RecordedRequest[]
  let sockets: FakeWs[]

  beforeEach(() => {
    vi.useFakeTimers()
    requests = []
    sockets = []
    mocks.runAgentStreaming.mockReset()
    mocks.runAgentStreaming.mockImplementation(
      async (_prompt: string, _win: unknown, onChunk?: (t: string) => void) => {
        onChunk?.('流式中间片段')
        return '最终回复内容'
      },
    )
  })

  afterEach(async () => {
    await dingtalkBotService.stop({ userInitiated: false }).catch(() => {})
    vi.useRealTimers()
  })

  async function startEngine(overrides: { allowGroups?: boolean } = {}): Promise<void> {
    await dingtalkBotService.start('client-1', 'secret-1', null, {
      allowGroups: overrides.allowGroups,
      fetchImpl: makeFetch(requests),
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
  }

  it('start → connecting→connected;文本消息走完整流水线到终稿', async () => {
    const statuses: string[] = []
    dingtalkBotService.on('status', (info: { status: string }) => statuses.push(info.status))
    await startEngine()
    expect(statuses).toContain('connected')

    sockets[0].feed(textFrame('proto-1', 'biz-1', '帮我分析班级成绩'))
    // 合并窗口 2s + 流式节流 900ms
    await vi.advanceTimersByTimeAsync(4000)

    // Agent 以纯文本 prompt 被调用一次
    expect(mocks.runAgentStreaming).toHaveBeenCalledTimes(1)
    const [prompt] = mocks.runAgentStreaming.mock.calls[0] as [string]
    expect(prompt).toContain('帮我分析班级成绩')

    // 卡片链路: 创建(公共模板) → 投放 → INPUTING → streaming 终帧 → FINISHED
    const cardCreate = requests.find(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'POST',
    )
    expect(cardCreate?.body.callbackType).toBe('STREAM')
    expect(requests.some((r) => r.url.endsWith('/v1.0/card/instances/deliver'))).toBe(true)
    const streaming = requests.filter((r) => r.url.endsWith('/v1.0/card/streaming'))
    expect(streaming.length).toBeGreaterThanOrEqual(1)
    expect(streaming[streaming.length - 1].body).toMatchObject({ isFinalize: true })
    const puts = requests.filter(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'PUT',
    )
    const lastParamMap = (
      puts[puts.length - 1].body as { cardData: { cardParamMap: Record<string, string> } }
    ).cardData.cardParamMap
    expect(lastParamMap.flowStatus).toBe('3') // FINISHED
    expect(lastParamMap.msgContent).toContain('最终回复内容')
    // 队列排空
    expect(dingtalkBotService.getStatus().pendingCount).toBe(0)
  })

  it('协议层(messageId)与业务层(msgId)双去重', async () => {
    await startEngine()
    sockets[0].feed(textFrame('proto-1', 'biz-1', '你好'))
    sockets[0].feed(textFrame('proto-1', 'biz-1', '你好')) // 协议层重推
    sockets[0].feed(textFrame('proto-2', 'biz-1', '你好')) // 业务层重发
    await vi.advanceTimersByTimeAsync(4000)
    expect(mocks.runAgentStreaming).toHaveBeenCalledTimes(1)
  })

  it('allowGroups=false 时群聊消息被忽略', async () => {
    await startEngine({ allowGroups: false })
    sockets[0].feed(textFrame('proto-9', 'biz-9', '群消息', true))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.runAgentStreaming).not.toHaveBeenCalled()
  })

  it('斜杠命令批直通: 不建卡片,不跑 Agent', async () => {
    // router.dispatch 依赖 command-context(已 mock 空对象) — 命令处理本身不在本用例断言范围
    await startEngine()
    sockets[0].feed(textFrame('proto-c', 'biz-c', '/echo 你好'))
    await vi.advanceTimersByTimeAsync(3000)
    // 命令批无 Agent 调用
    expect(mocks.runAgentStreaming).not.toHaveBeenCalled()
    // webhook 或某种回复发生(取决于路由是否处理 /echo;至少不建卡片)
    expect(requests.some((r) => r.url.endsWith('/v1.0/card/instances/deliver'))).toBe(false)
  })

  it('stop(): 未处理消息收尾通知(卡片或 webhook 任一路径)', async () => {
    await startEngine()
    // 直接 stop,队列中的消息应经 onDrop 收尾(占位卡片已建 → 卡片终稿通知)
    sockets[0].feed(textFrame('proto-s', 'biz-s', '还没处理'))
    await dingtalkBotService.stop()
    const notice = requests.find((r) => JSON.stringify(r.body).includes('未处理'))
    expect(notice).toBeDefined()
  })
})
