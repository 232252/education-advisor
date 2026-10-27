// =============================================================
// qqBotService — QQ WS 引擎测试
// 真 ChatMessageQueue/parsing + 假 QqApiClient/QqGatewayClient/
// pipeline hooks。网关构造捕获 onDispatch 供注入事件,pipeline
// 构造捕获 opts 供直测附件下载。覆盖: 凭证防呆、凭证校验失败、
// 连接/错误/重连状态透传、C2C/群消息入队与去重、群开关过滤、
// 队列满回繁忙、出站三件套、附件下载三态、stop 语义。
// =============================================================

import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateCredentials: vi.fn(),
  replyOutbound: vi.fn(async () => {}),
  replyText: vi.fn(async () => {}),
  gatewayConnect: vi.fn(),
  gatewayStop: vi.fn(),
  onPlaceholder: vi.fn(),
  onBatch: vi.fn(async () => {}),
  onDrop: vi.fn(async () => {}),
  fetchImpl: vi.fn(),
  writeAttachmentBytes: vi.fn(),
  getPath: vi.fn((n: string) => join(tmpdir(), 'qq-engine-default', n)),
}))

let gatewayOpts: { onDispatch: (t: string, d: unknown) => void } | null = null
let gatewayInstance: EventEmitter | null = null
let pipelineOpts: Record<string, unknown> | null = null

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
}))
vi.mock('../../src/main/services/channels/adapters/qq/api', () => ({
  QqApiClient: class {
    validateCredentials = mocks.validateCredentials
    replyOutbound = mocks.replyOutbound
    replyText = mocks.replyText
  },
}))
vi.mock('../../src/main/services/channels/adapters/qq/gateway', () => ({
  QqGatewayClient: class extends EventEmitter {
    constructor(opts: { onDispatch: (t: string, d: unknown) => void }) {
      super()
      gatewayOpts = opts
      gatewayInstance = this
    }
    connect = mocks.gatewayConnect
    stop = mocks.gatewayStop
  },
}))
vi.mock('../../src/main/services/channels/bridge/pipeline', () => ({
  createChannelPipeline: (opts: Record<string, unknown>) => {
    pipelineOpts = opts
    return {
      onPlaceholder: mocks.onPlaceholder,
      onBatch: mocks.onBatch,
      onDrop: mocks.onDrop,
    }
  },
}))
vi.mock('../../src/main/services/channels/bridge/agent-runner', () => ({
  runAgentStreaming: vi.fn(),
}))
vi.mock('../../src/main/services/channels/bridge/command-context', () => ({
  createCommandContext: () => ({}),
}))
vi.mock('../../src/main/services/channels/adapters/qq/reply-session', () => ({
  createQqReplySession: vi.fn(() => ({ fail: vi.fn(async () => {}) })),
}))
vi.mock('../../src/main/services/channels/runtime/attachment-store', () => ({
  writeAttachmentBytes: mocks.writeAttachmentBytes,
}))

import { qqBotService } from '../../src/main/services/channels/adapters/qq/connection'

function c2c(id: string, text: string, openid = 'uo-1') {
  return { id, content: text, author: { user_openid: openid } }
}

function groupMsg(id: string, text: string) {
  return {
    id,
    content: text,
    author: { member_openid: 'mo-1' },
    group_openid: 'go-1',
  }
}

async function startOk() {
  mocks.validateCredentials.mockResolvedValue(null)
  mocks.gatewayConnect.mockImplementation(async function (this: EventEmitter) {
    this.emit('status', 'connected')
  })
  await qqBotService.start('10086', 'secret', null, { fetchImpl: mocks.fetchImpl })
}

describe('qqBotService 引擎', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gatewayOpts = null
    gatewayInstance = null
    pipelineOpts = null
    mocks.onBatch.mockImplementation(async () => {})
    mocks.onPlaceholder.mockResolvedValue(null)
  })
  afterEach(async () => {
    await qqBotService.stop()
    vi.useRealTimers()
  })

  it('空凭证防呆: error 且不建网关', async () => {
    await qqBotService.start('  ', 'secret', null)
    expect(qqBotService.getStatus().status).toBe('error')
    expect(qqBotService.getStatus().error).toContain('为空')
    expect(gatewayOpts).toBeNull()
  })

  it('凭证校验失败: error 且不连网关', async () => {
    mocks.validateCredentials.mockResolvedValue('invalid client_secret')
    await qqBotService.start('10086', 'bad', null)
    expect(qqBotService.getStatus().status).toBe('error')
    expect(qqBotService.getStatus().error).toBe('invalid client_secret')
    expect(gatewayOpts).toBeNull()
  })

  it('连接成功/网关错误/重连三种状态透传', async () => {
    await startOk()
    expect(qqBotService.getStatus().status).toBe('connected')

    ;(gatewayInstance as EventEmitter).emit('status', 'error', 'WS 握手失败')
    expect(qqBotService.getStatus().status).toBe('error')
    expect(qqBotService.getStatus().error).toBe('WS 握手失败')

    ;(gatewayInstance as EventEmitter).emit('reconnect', 3, 5000)
    expect(qqBotService.getStatus().reconnectAttempt).toBe(3)
  })

  it('C2C 消息入队(合并窗后占位+批),同 id 去重', async () => {
    vi.useFakeTimers()
    await startOk()
    gatewayOpts?.onDispatch('C2C_MESSAGE_CREATE', c2c('m1', '你好'))
    gatewayOpts?.onDispatch('C2C_MESSAGE_CREATE', c2c('m1', '你好'))
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(1)
    expect(mocks.onPlaceholder.mock.calls[0][0].parsed).toMatchObject({
      messageId: 'm1',
      chatId: 'uo-1',
      chatType: 'p2p',
      text: '你好',
    })
    expect(mocks.onBatch).toHaveBeenCalledTimes(1)
    expect(qqBotService.getDelivery('m1')).toMatchObject({ kind: 'c2c', openid: 'uo-1' })
  })

  it('群消息: allowGroups=false 过滤;默认 true 入队且 delivery 带 group', async () => {
    vi.useFakeTimers()
    mocks.validateCredentials.mockResolvedValue(null)
    mocks.gatewayConnect.mockImplementation(async function (this: EventEmitter) {
      this.emit('status', 'connected')
    })
    await qqBotService.start('10086', 's', null, { allowGroups: false })
    gatewayOpts?.onDispatch('GROUP_AT_MESSAGE_CREATE', groupMsg('g1', 'hi'))
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).not.toHaveBeenCalled()

    await qqBotService.stop()
    vi.clearAllMocks()
    await startOk()
    gatewayOpts?.onDispatch('GROUP_AT_MESSAGE_CREATE', groupMsg('g1', 'hi'))
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(1)
    expect(qqBotService.getDelivery('g1')).toMatchObject({
      kind: 'group',
      groupOpenid: 'go-1',
    })
  })

  it('队列满: api.replyText 回繁忙', async () => {
    vi.useFakeTimers()
    mocks.onBatch.mockImplementation(() => new Promise(() => {}))
    await startOk()
    for (let i = 0; i < 17; i++) {
      gatewayOpts?.onDispatch('C2C_MESSAGE_CREATE', c2c('f' + i, 'm' + i, 'u' + i))
    }
    await vi.advanceTimersByTimeAsync(2100)
    expect(mocks.onPlaceholder).toHaveBeenCalledTimes(16)
    expect(mocks.replyText).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'c2c', openid: 'u16' }),
      expect.stringContaining('繁忙'),
    )
  })

  it('出站三件套: 未连接抛错/投递失效抛错/正常委托', async () => {
    await expect(qqBotService.replyOutboundFromMessage('x', 'hi')).rejects.toThrow('QQ 未连接')
    expect(() => qqBotService.createReplySessionFromMessage('x')).toThrow('QQ 未连接')

    await startOk()
    gatewayOpts?.onDispatch('C2C_MESSAGE_CREATE', c2c('m9', 'go'))
    await qqBotService.replyOutboundFromMessage('m9', '答复')
    expect(mocks.replyOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ msgId: 'm9' }),
      '答复',
      [],
    )
    const s = qqBotService.createReplySessionFromMessage('m9')
    expect(s).toBeTruthy()
    await expect(qqBotService.replyOutboundFromMessage('ghost', 'x')).rejects.toThrow('已失效')
  })

  it('附件下载三态: 非 URL 拒 / HTTP 失败 / 成功写盘带 basename', async () => {
    await startOk()
    const dl = pipelineOpts?.downloadAttachment as (
      _m: string,
      att: { fileKey: string; fileName?: string; kind: string },
    ) => Promise<{ ok: boolean; error?: string; saved?: { name: string } }>
    const bad = await dl('m', { fileKey: 'ftp://x', kind: 'file' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('无效')

    mocks.fetchImpl.mockResolvedValueOnce({ ok: false, status: 404 })
    const http404 = await dl('m', { fileKey: 'https://cdn/f.png', kind: 'image' })
    expect(http404.ok).toBe(false)
    expect(http404.error).toContain('404')

    mocks.fetchImpl.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    })
    mocks.writeAttachmentBytes.mockResolvedValueOnce({ ok: true, saved: { name: 'pic.png' } })
    const ok = await dl('m', {
      fileKey: 'https://cdn/a/b/pic.png?sig=1',
      kind: 'image',
    })
    expect(ok.ok).toBe(true)
    expect(mocks.writeAttachmentBytes).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'pic.png', kind: 'image' }),
    )
  })

  it('connect 抛错: error 且网关清空;stop 归 idle 并撤网关', async () => {
    mocks.validateCredentials.mockResolvedValue(null)
    mocks.gatewayConnect.mockRejectedValue(new Error('ECONNREFUSED'))
    await qqBotService.start('10086', 's', null)
    expect(qqBotService.getStatus().status).toBe('error')
    expect(qqBotService.getStatus().error).toContain('ECONNREFUSED')
    await expect(qqBotService.replyOutboundFromMessage('x', 'y')).rejects.toThrow('QQ 未连接')

    vi.clearAllMocks()
    await startOk()
    await qqBotService.stop()
    expect(mocks.gatewayStop).toHaveBeenCalled()
    expect(qqBotService.getStatus().status).toBe('idle')
  })
})