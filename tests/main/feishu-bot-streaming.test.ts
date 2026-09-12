// =============================================================
// feishu-bot 阶段 0 测试(二):
//   streaming-card — CardKit 流式会话(sequence/节流/终稿关流式/降级)
//   file-receive   — 文件名清洗/下载落盘/权限失败
//   message-handler批流水线 — 纯文件确认/文件+文字组 prompt/流式注入
// =============================================================

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentFilesStore } from '../../src/main/services/feishu-bot/recent-files'
import type { ReplySession } from '../../src/main/services/feishu-bot/streaming-card'
import type { FeishuCommandRouter } from '../../src/main/services/feishu-bot/command-router'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}))
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))
vi.mock('../../src/main/services/agent-service', () => ({
  agentService: {
    listAgents: () => [{ id: 'main', name: 'Main', enabled: true }],
    runAgent: vi.fn(),
    getHistory: () => [],
  },
}))

const fetchMock = vi.fn()
const replyMock = vi.fn()

function fakeSdkClient() {
  return { im: { message: { reply: replyMock } } }
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => data,
  }
}

function binaryResponse(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/octet-stream' },
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  replyMock.mockReset().mockResolvedValue({ code: 0, msg: 'ok' })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------- streaming-card ----------

describe('streaming-card — CardKit 流式会话(阶段 0)', () => {
  it('占位秒回卡片 + 节流更新(sequence 递增) + 终稿关闭流式', async () => {
    vi.useFakeTimers()
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'get',
        url,
        body: init.body ? JSON.parse(String(init.body)) : {},
      })
      if (url.includes('/cardkit/v1/cards') && !url.includes('/elements/') && !url.includes('/settings')) {
        return jsonResponse({ code: 0, data: { card_id: 'cc_1' } })
      }
      return jsonResponse({ code: 0 })
    })
    const { createReplySession } = await import(
      '../../src/main/services/feishu-bot/streaming-card'
    )
    const session = await createReplySession(
      { getSdkClient: () => fakeSdkClient() as never, getAccessToken: async () => 'tok' },
      'om_1',
      '正在思考…',
    )
    // 占位已发出:1x 创建卡片实体 + 1x 卡片消息回复
    expect(calls.filter((c) => c.method === 'post').length).toBe(1)
    expect(replyMock).toHaveBeenCalledTimes(1)

    // 900ms 内两次 update 只应产生一次 PUT(节流,全量文本)
    session.update('你')
    session.update('你好世界')
    await vi.advanceTimersByTimeAsync(1000)
    const puts = calls.filter((c) => c.method === 'put')
    expect(puts.length).toBe(1)
    expect(puts[0].url).toContain('/cards/cc_1/elements/content')
    expect(puts[0].body.content).toBe('你好世界')
    expect(puts[0].body.sequence).toBe(2)

    // 终稿:PUT + PATCH settings(streaming_mode false),sequence 继续递增
    await session.finalize('最终答案:完成了')
    const finalPuts = calls.filter((c) => c.method === 'put')
    const patches = calls.filter((c) => c.method === 'patch')
    expect(finalPuts.length).toBe(2)
    expect(finalPuts[1].body.content).toBe('最终答案:完成了')
    expect(finalPuts[1].body.sequence).toBe(3)
    expect(patches.length).toBe(1)
    expect(String(patches[0].body.settings)).toContain('"streaming_mode":false')

    // finalize 幂等
    await session.finalize('再调一次应为 no-op')
    expect(calls.filter((c) => c.method === 'put').length).toBe(2)
  })

  it('CardKit 失败(缺权限)→ 降级纯文本占位 + 最终纯文本', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 99991672, msg: 'no permission' }))
    const { createReplySession } = await import(
      '../../src/main/services/feishu-bot/streaming-card'
    )
    const session = await createReplySession(
      { getSdkClient: () => fakeSdkClient() as never, getAccessToken: async () => 'tok' },
      'om_1',
      '正在思考…',
    )
    // 占位纯文本已发
    const placeholder = JSON.parse(replyMock.mock.calls[0][0].data.content) as { text: string }
    expect(placeholder.text).toBe('正在思考…')
    session.update('流式内容') // no-op
    await session.finalize('最终回复')
    expect(replyMock).toHaveBeenCalledTimes(2)
    const finalReply = JSON.parse(replyMock.mock.calls[1][0].data.content) as { text: string }
    expect(finalReply.text).toBe('最终回复')
  })

  it('拿不到 token → 直接降级纯文本', async () => {
    const { createReplySession } = await import(
      '../../src/main/services/feishu-bot/streaming-card'
    )
    const session = await createReplySession(
      { getSdkClient: () => fakeSdkClient() as never, getAccessToken: async () => null },
      'om_1',
      '正在思考…',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(replyMock).toHaveBeenCalledTimes(1)
    await session.fail('出错了')
    expect(replyMock).toHaveBeenCalledTimes(2)
    const errReply = JSON.parse(replyMock.mock.calls[1][0].data.content) as { text: string }
    expect(errReply.text).toBe('出错了')
  })
})

// ---------- file-receive ----------

describe('file-receive — 文件名清洗/下载落盘(阶段 0)', () => {
  it('sanitizeFileName 去路径分隔与穿越片段', async () => {
    const { sanitizeFileName } = await import('../../src/main/services/feishu-bot/file-receive')
    expect(sanitizeFileName('../../evil.xlsx')).toBe('.._.._evil.xlsx')
    expect(sanitizeFileName('a/b\\c.txt')).toBe('a_b_c.txt')
    expect(sanitizeFileName('..')).toBe('file')
    expect(sanitizeFileName('正常文件-2024.xlsx')).toBe('正常文件-2024.xlsx')
  })

  it('saveAttachment 成功下载并落盘(保留原始文件名)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-files-test-'))
    try {
      const bytes = new TextEncoder().encode('xlsx-bytes')
      fetchMock.mockResolvedValue(binaryResponse(bytes))
      const { saveAttachment } = await import('../../src/main/services/feishu-bot/file-receive')
      const r = await saveAttachment({
        getAccessToken: async () => 'tok',
        messageId: 'om_9',
        fileKey: 'fk_9',
        kind: 'file',
        fileName: '统计表.xlsx',
        dir,
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.saved.name).toBe('统计表.xlsx')
        expect(r.saved.path).toContain('统计表.xlsx')
        expect(await readFile(r.saved.path, 'utf8')).toBe('xlsx-bytes')
      }
      const callUrl = fetchMock.mock.calls[0][0] as string
      expect(callUrl).toContain('/im/v1/messages/om_9/resources/fk_9?type=file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('飞书返回业务错误(缺权限)→ ok:false 且提示权限', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 99991672, msg: 'no permission' }))
    const { saveAttachment } = await import('../../src/main/services/feishu-bot/file-receive')
    const r = await saveAttachment({
      getAccessToken: async () => 'tok',
      messageId: 'om_9',
      fileKey: 'fk_9',
      kind: 'image',
      dir: '/tmp/unused',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('权限')
  })
})

// ---------- message-handler 批流水线 ----------

describe('message-handler — 批流水线(阶段 0)', () => {
  function baseDeps(dir: string) {
    return {
      router: { dispatch: vi.fn(async () => null) } as unknown as FeishuCommandRouter,
      getSdkClient: () => fakeSdkClient() as never,
      // 有 token:cardkit 创建会被 fetch 路由判为无权限 → 确定性走纯文本降级;
      // 附件下载正常拿 token
      getAccessToken: async () => 'tok' as string | null,
      filesDir: dir,
      onProcessingStart: vi.fn(),
      onProcessingEnd: vi.fn(),
      activeSessions: new Set<ReplySession>(),
      recentFiles: new RecentFilesStore(),
    }
  }

  /** fetch 路由:cardkit 创建 → 无权限(降级);资源下载 → 二进制 */
  function routeFetch(bytes: Uint8Array) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/cardkit/v1/cards')) {
        return jsonResponse({ code: 99991672, msg: 'no permission' })
      }
      return binaryResponse(bytes)
    })
  }

  function makeParsed(overrides: Partial<{ text: string; messageId: string; attachments: Array<{ kind: 'file'; fileKey: string; fileName?: string }> }>) {
    return {
      text: overrides.text ?? '',
      messageId: overrides.messageId ?? 'om_p',
      chatId: 'oc_p',
      chatType: 'p2p',
      attachments: overrides.attachments ?? [],
    }
  }

  it('纯文件批:下载保存 + 回确认,不跑 Agent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-pipeline-'))
    try {
      const bytes = new TextEncoder().encode('data')
      routeFetch(bytes)
      const { agentService } = await import('../../src/main/services/agent-service')
      const { createBatchPipeline } = await import(
        '../../src/main/services/feishu-bot/message-handler'
      )
      const deps = baseDeps(dir)
      const pipeline = createBatchPipeline(deps, { runEAA: vi.fn(), listAgents: () => [], runAgent: vi.fn() }, null)
      const item = { parsed: makeParsed({ messageId: 'om_f1', attachments: [{ kind: 'file', fileKey: 'fk_1', fileName: '表.xlsx' }] }) }
      const session = await pipeline.onPlaceholder(item, 0)
      await pipeline.onBatch({ items: [item], session })
      expect((agentService.runAgent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
      expect(replyMock).toHaveBeenCalledTimes(2) // 占位 + 确认
      const ack = JSON.parse(replyMock.mock.calls[1][0].data.content) as { text: string }
      expect(ack.text).toContain('表.xlsx')
      expect(ack.text).toContain(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('文件+文字批:组 prompt(文件路径 + 说明)并流式回填', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-pipeline-'))
    try {
      const bytes = new TextEncoder().encode('data')
      routeFetch(bytes)
      const { agentService } = await import('../../src/main/services/agent-service')
      const runAgentMock = agentService.runAgent as ReturnType<typeof vi.fn>
      // 挂起执行期间发流式增量,验证会话被 update
      let resolveRun!: (v: unknown) => void
      const updates: string[] = []
      runAgentMock.mockImplementation(async () => {
        const { agentEvents } = await import('../../src/main/services/agent/agent-events')
        agentEvents.emit('status', { agentId: 'main', status: 'running', output: '部分答案' })
        agentEvents.emit('status', { agentId: 'main', status: 'running', output: '继续' })
        return new Promise((r) => {
          resolveRun = r
        })
      })
      const { createBatchPipeline } = await import(
        '../../src/main/services/feishu-bot/message-handler'
      )
      const deps = baseDeps(dir)
      const pipeline = createBatchPipeline(
        deps,
        { runEAA: vi.fn(), listAgents: () => [], runAgent: vi.fn() },
        null,
      )
      const fileItem = {
        parsed: makeParsed({
          messageId: 'om_f2',
          attachments: [{ kind: 'file', fileKey: 'fk_2', fileName: '名单.xlsx' }],
        }),
      }
      const textItem = { parsed: makeParsed({ text: '把这份表录入成绩', messageId: 'om_t2' }) }
      const session = await pipeline.onPlaceholder(fileItem, 0)
      // 包一层捕获流式回填
      const wrappedSession = {
        update: (t: string) => updates.push(t),
        finalize: session.finalize.bind(session),
        fail: session.fail.bind(session),
      }
      const batchPromise = pipeline.onBatch({ items: [fileItem, textItem], session: wrappedSession as never })
      await vi.waitFor(() => expect(updates.length).toBe(2))
      expect(updates).toEqual(['部分答案', '部分答案继续']) // 累计全量
      resolveRun({ status: 'success', output: '已录入完成' })
      await batchPromise
      const prompt = runAgentMock.mock.calls[0][1] as string
      expect(prompt).toContain('名单.xlsx')
      expect(prompt).toContain('把这份表录入成绩')
      expect(prompt).toContain(dir)
      // 终稿纯文本回复
      const finalReply = JSON.parse(replyMock.mock.calls.at(-1)![0].data.content) as { text: string }
      expect(finalReply.text).toBe('已录入完成')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('onDrop:停止时占位卡片写入未处理提示', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-pipeline-'))
    try {
      const { createBatchPipeline } = await import(
        '../../src/main/services/feishu-bot/message-handler'
      )
      const deps = baseDeps(dir)
      const pipeline = createBatchPipeline(
        deps,
        { runEAA: vi.fn(), listAgents: () => [], runAgent: vi.fn() },
        null,
      )
      const item = { parsed: makeParsed({ text: '没处理的消息', messageId: 'om_d1' }) }
      const session = await pipeline.onPlaceholder(item, 0)
      await pipeline.onDrop([item], session)
      const notice = JSON.parse(replyMock.mock.calls.at(-1)![0].data.content) as { text: string }
      expect(notice.text).toContain('未处理')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
