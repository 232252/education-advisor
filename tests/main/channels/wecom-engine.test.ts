// =============================================================
// 企微引擎(connection)端到端集成 — 注入假 WS/假 Agent/假 fetch:
//   订阅建连 → msg_callback → 去重 → 队列合并 → 占位流式首帧 →
//   Agent 流式 → respond-stream 终帧;群聊过滤、主动推送、
//   附件预取(收帧即下载解密)、stop 排空收尾。
// =============================================================

import { EventEmitter } from 'node:events'
import { createCipheriv, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runAgentStreaming: vi.fn(),
}))

vi.mock('electron', () => ({
  // 附件落盘走 tmpdir,不污染仓库/系统盘
  app: { getPath: vi.fn(() => `${tmpdir()}${'\\'}ea-wecom-test-userData`), isPackaged: false },
  powerMonitor: new EventEmitter(),
  BrowserWindow: class {},
}))

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

vi.mock('../../../src/main/services/channels/bridge/agent-runner', () => ({
  runAgentStreaming: mocks.runAgentStreaming,
  runAgentAndCollect: vi.fn(),
}))

vi.mock('../../../src/main/services/channels/bridge/command-context', () => ({
  createCommandContext: vi.fn(() => ({}) as unknown as Record<string, unknown>),
}))

// 落盘走内存假实现(真实 fs 在 fake timers 推进窗口内不可靠完成;
// 加解密往返由 wecom-crypto.test 锚定,这里只验引擎编排)
vi.mock('../../../src/main/services/channels/runtime/attachment-store', () => ({
  writeAttachmentBytes: vi.fn(
    async (opts: { bytes: Uint8Array; fileName?: string; kind: string }) => ({
      ok: true as const,
      saved: {
        name: opts.fileName ?? `${opts.kind}-test`,
        path: `${tmpdir()}\\ea-wecom-test-userData\\wecom-files\\${opts.fileName ?? 'f'}`,
        bytes: opts.bytes.byteLength,
      },
    }),
  ),
  cleanExpiredFiles: vi.fn(async () => {}),
  formatBytes: (n: number) => `${n}B`,
}))

import { wecomBotService } from '../../../src/main/services/channels/adapters/wecom/connection'
import type { WsLike } from '../../../src/main/services/channels/adapters/dingtalk/stream-client'

class FakeWs extends EventEmitter implements WsLike {
  sent: string[] = []
  closed = false
  constructor(public url: string) {
    super()
  }
  send(data: string): void {
    this.sent.push(data)
    const frame = JSON.parse(data) as { cmd?: string; headers?: { req_id?: string } }
    if (frame.cmd === 'aibot_subscribe' || frame.cmd === 'ping') {
      queueMicrotask(() => {
        this.emit(
          'message',
          Buffer.from(JSON.stringify({ headers: { req_id: frame.headers?.req_id }, errcode: 0 })),
        )
      })
    }
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
  /** 已发出的 respond_msg 流式帧 */
  streamFrames(): Array<{ reqId: string; stream: { id: string; finish: boolean; content: string } }> {
    return this.sent
      .map((s) => JSON.parse(s) as {
        cmd?: string
        headers?: { req_id?: string }
        body?: { stream?: { id: string; finish: boolean; content: string } }
      })
      .filter((f) => f.cmd === 'aibot_respond_msg')
      .map((f) => ({ reqId: f.headers?.req_id ?? '', stream: f.body?.stream as never }))
  }
}

function textFrame(reqId: string, msgid: string, text: string, group = false): unknown {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: reqId },
    body: {
      msgid,
      chattype: group ? 'group' : 'single',
      ...(group ? { chatid: 'chat-g-1' } : {}),
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: text },
    },
  }
}

describe('WecomBotService(引擎集成)', () => {
  let sockets: FakeWs[]

  beforeEach(() => {
    vi.useFakeTimers()
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
    await wecomBotService.stop({ userInitiated: false }).catch(() => {})
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function startEngine(overrides: { allowGroups?: boolean } = {}): Promise<void> {
    await wecomBotService.start('bot-1', 'ws-secret', null, {
      allowGroups: overrides.allowGroups,
      wsFactory: (url) => {
        const ws = new FakeWs(url)
        sockets.push(ws)
        queueMicrotask(() => ws.emit('open'))
        return ws
      },
    })
  }

  it('start → connected;文本消息走完整流水线到 respond-stream 终帧', async () => {
    const statuses: string[] = []
    wecomBotService.on('status', (info: { status: string }) => statuses.push(info.status))
    await startEngine()
    expect(statuses).toContain('connected')

    sockets[0].feed(textFrame('cb_1', 'msg-1', '帮我分析班级成绩'))
    // 合并窗口 2s + 流式节流 900ms
    await vi.advanceTimersByTimeAsync(4000)

    // Agent 以纯文本 prompt 被调用一次
    expect(mocks.runAgentStreaming).toHaveBeenCalledTimes(1)
    const [prompt] = mocks.runAgentStreaming.mock.calls[0] as [string]
    expect(prompt).toContain('帮我分析班级成绩')

    // respond-stream: 占位首帧 → … → finish 终帧(全量文本),req_id 透传
    const frames = sockets[0].streamFrames()
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames[0]).toMatchObject({ reqId: 'cb_1' })
    expect(frames[0].stream.content).toContain('正在思考')
    expect(frames[0].stream.finish).toBe(false)
    const last = frames[frames.length - 1]
    expect(last.stream.finish).toBe(true)
    expect(last.stream.content).toContain('最终回复内容')
    // 同一 stream.id 贯穿始终
    expect(new Set(frames.map((f) => f.stream.id)).size).toBe(1)
    // 队列排空
    expect(wecomBotService.getStatus().pendingCount).toBe(0)
    wecomBotService.removeListener('status', () => {})
  })

  it('msgid 业务去重(同帧重推只处理一次)', async () => {
    await startEngine()
    sockets[0].feed(textFrame('cb_1', 'msg-1', '你好'))
    sockets[0].feed(textFrame('cb_1', 'msg-1', '你好'))
    sockets[0].feed(textFrame('cb_2', 'msg-1', '你好'))
    await vi.advanceTimersByTimeAsync(4000)
    expect(mocks.runAgentStreaming).toHaveBeenCalledTimes(1)
  })

  it('allowGroups=false 时群聊消息被忽略', async () => {
    await startEngine({ allowGroups: false })
    sockets[0].feed(textFrame('cb_g', 'msg-g', '群消息', true))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.runAgentStreaming).not.toHaveBeenCalled()
  })

  it('sendProactive: aibot_send_msg 帧带 chatid', async () => {
    await startEngine()
    wecomBotService.sendProactive('chat-g-1', '定时任务完成提醒')
    const sent = sockets[0].sent.map((s) => JSON.parse(s) as Record<string, unknown>)
    const pushFrame = sent.find((f) => f.cmd === 'aibot_send_msg')
    expect(pushFrame?.body).toMatchObject({
      chatid: 'chat-g-1',
      msgtype: 'text',
      text: { content: '定时任务完成提醒' },
    })
    // 未连接时抛可读错误
    await wecomBotService.stop({ userInitiated: false })
    expect(() => wecomBotService.sendProactive('x', 'y')).toThrow(/未连接/)
  })

  it('附件: 收帧即预取下载+AES解密;文件批走 Agent 且 prompt 注入保存路径', async () => {
    // 镜像加密(与 crypto.test 相同配方)
    const key = randomBytes(32)
    const aesKeyBase64 = key.toString('base64')
    const iv = key.subarray(0, 16)
    const cipher = createCipheriv('aes-256-cbc', key, iv)
    cipher.setAutoPadding(false)
    const plain = Buffer.from('学生名单,CSV 内容')
    const padLen = 32 - (plain.length % 32)
    const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([plain, Buffer.alloc(padLen, padLen)])),
      cipher.final(),
    ])
    const fetchedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string): Promise<Response> => {
        fetchedUrls.push(String(url))
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => encrypted.buffer.slice(
            encrypted.byteOffset,
            encrypted.byteOffset + encrypted.byteLength,
          ),
        } as unknown as Response
      }),
    )

    await startEngine()
    sockets[0].feed({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'cb_f1' },
      body: {
        msgid: 'msg-f1',
        chattype: 'single',
        from: { userid: 'user-1' },
        msgtype: 'file',
        file: { url: 'https://f.wecom.example/dl?f=1', aeskey: aesKeyBase64 },
      },
    })
    // 预取立即发起(url 5 分钟时效)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchedUrls).toContain('https://f.wecom.example/dl?f=1')
    // 文件批: Agent prompt 注入渠道名 + 保存路径(与钉钉同构)
    await vi.advanceTimersByTimeAsync(4000)
    expect(mocks.runAgentStreaming).toHaveBeenCalledTimes(1)
    const [prompt] = mocks.runAgentStreaming.mock.calls[0] as [string]
    expect(prompt).toContain('用户通过企业微信发来了文件')
    expect(prompt).toContain('已保存到本机')
    expect(prompt).toContain('《file》')
    const last = sockets[0].streamFrames().at(-1)
    expect(last?.stream.finish).toBe(true)
    expect(last?.stream.content).toContain('最终回复内容')
  })

  it('stop(): 在途消息收尾通知(未处理/中断任一文案)', async () => {
    await startEngine()
    sockets[0].feed(textFrame('cb_s', 'msg-s', '还没处理'))
    await wecomBotService.stop()
    const frames = sockets[0].streamFrames()
    const last = frames.at(-1)
    expect(last?.stream.finish).toBe(true)
    expect(last?.stream.content).toMatch(/未处理|已中断/)
  })
})
