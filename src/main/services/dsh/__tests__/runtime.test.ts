import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { StreamEvent } from '@shared/types/ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureDshCatalogSource, getDshCatalogRoot } from '../dsh-model-catalog'
import { EAA_HARDENING_PATCH_FILE } from '../hardening'
import { configureDshCredentials, EAA_PROVIDER_PATCH_FILE } from '../provider-patch'
import type { DshClientLike, DshNotification, DshSubscriptionLike } from '../runtime'
import {
  configureDshRuntime,
  createDshRuntime,
  DshRuntime,
  dshLaunchOptions,
  dshPinnedKey,
  resolveDshEntryPath,
  retargetPackagedDsh,
  toUnpackedAsarPath,
} from '../runtime'
import { DSH_TURN_ABORTED, DSH_TURN_ERROR } from '../stream-mapper'

/** 复刻 dsh NotificationSubscription：filter 是纯谓词，close 让挂起的 next 立即 reject */
class FakeSubscription implements DshSubscriptionLike {
  private readonly queued: DshNotification[] = []
  private readonly waiters: { res: (n: DshNotification) => void; rej: (e: Error) => void }[] = []
  private closed = false
  closeCount = 0

  constructor(private readonly filter: (n: DshNotification) => boolean) {}

  deliver(n: DshNotification): void {
    if (this.closed || !this.filter(n)) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.res(n)
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
    this.closeCount++
    this.queued.length = 0
    for (const w of this.waiters.splice(0)) w.rej(new Error('subscription closed'))
  }
}

interface FakeState {
  initialized: number
  closed: number
  promptBlocks: unknown
  initParams: unknown
  sessionIds: string[]
  sub: FakeSubscription | null
}

function makeFake(
  script: (ctx: { sessionId: string; emit: (n: DshNotification) => void }) => void,
  rejectWith?: Error,
): { client: DshClientLike; state: FakeState } {
  const state: FakeState = {
    initialized: 0,
    closed: 0,
    promptBlocks: null,
    initParams: null,
    sessionIds: [],
    sub: null,
  }
  const client: DshClientLike = {
    async initialize(params: unknown) {
      state.initialized++
      state.initParams = params
      return { serverInfo: { name: 'fake', version: '0' } }
    },
    prompt(sessionId, blocks) {
      state.promptBlocks = blocks
      state.sessionIds.push(sessionId)
      script({ sessionId, emit: (n) => state.sub?.deliver(n) })
      return rejectWith ? Promise.reject(rejectWith) : Promise.resolve({ messageId: 'm' })
    },
    subscribe(filter) {
      state.sub = new FakeSubscription(filter)
      return state.sub
    },
    async close() {
      state.closed++
    },
  }
  return { client, state }
}

const runtime = (client: DshClientLike) =>
  new DshRuntime({ cwd: '/tmp', provider: 'p', model: 'm', createClient: async () => client })

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const notif = (sessionId: string, event: unknown): DshNotification =>
  ({ method: 'session.event', params: { sessionId, event } }) as unknown as DshNotification

const textMsg = (sessionId: string, texts: string[], input: number, output: number) =>
  notif(sessionId, {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      stream: [{ type: 'text-chunks', texts }],
      usage: { inputTokens: input, outputTokens: output },
    },
  })

const toolCall = (sessionId: string) =>
  notif(sessionId, {
    type: 'tool/call',
    data: { callId: 'c1', name: 'class_create', arguments: '{"name":"高一4班"}' },
  })

const turnEnd = (sessionId: string) =>
  notif(sessionId, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

const params = (content = '问题') => ({
  providerId: 'deepseek-official',
  modelId: 'deepseek-v4-flash',
  messages: [{ role: 'user', content }],
})

describe('DshRuntime.chatStream', () => {
  it('首事件 start、末事件 done，中间是文本增量', async () => {
    const { client } = makeFake(({ sessionId, emit }) => {
      emit(textMsg(sessionId, ['你好'], 3, 5))
      emit(turnEnd(sessionId))
    })
    const out = await collect(runtime(client).chatStream(params()))
    expect(out.map((e) => e.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_end',
      'done',
    ])
    expect(out[0]).toEqual({
      type: 'start',
      model: 'deepseek-v4-flash',
      provider: 'deepseek-official',
    })
    expect(out[out.length - 1]).toEqual({
      type: 'done',
      cost: 0,
      usage: { inputTokens: 3, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it('多 step 的 turn 只发一个 done，usage 跨 step 累加', async () => {
    const { client } = makeFake(({ sessionId, emit }) => {
      emit(textMsg(sessionId, ['第一段'], 10, 2))
      emit(toolCall(sessionId))
      emit(textMsg(sessionId, ['第二段'], 7, 4))
      emit(turnEnd(sessionId))
    })
    const out = await collect(runtime(client).chatStream(params()))
    expect(out.filter((e) => e.type === 'done')).toEqual([
      {
        type: 'done',
        cost: 0,
        usage: { inputTokens: 17, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
    expect(out.map((e) => e.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_end',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_end',
      'text_start',
      'text_delta',
      'text_end',
      'done',
    ])
  })

  it('filter 生效：其它 session 的事件不进入本流', async () => {
    const { client } = makeFake(({ sessionId, emit }) => {
      emit(textMsg('other-session', ['噪音'], 1, 1))
      emit(textMsg(sessionId, ['正文'], 2, 2))
      emit(turnEnd(sessionId))
    })
    const out = await collect(runtime(client).chatStream(params()))
    expect(out.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', delta: '正文' },
    ])
  })

  it('prompt 失败时抛出底层错误而非订阅关闭错误，并释放订阅', async () => {
    const { client, state } = makeFake(() => {}, new Error('runtime died'))
    await expect(collect(runtime(client).chatStream(params()))).rejects.toThrow('runtime died')
    expect(state.sub?.closeCount).toBeGreaterThanOrEqual(1)
  })

  it('多轮对话把整段历史按顺序带上（只发最后一句＝没有上下文）', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    await collect(
      runtime(client).chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [
          { role: 'user', content: '旧问题' },
          { role: 'assistant', content: '旧回答' },
          { role: 'user', content: '新问题' },
        ],
      }),
    )
    expect(state.promptBlocks).toEqual([
      { type: 'text', text: 'user: 旧问题\nassistant: 旧回答\nuser: 新问题' },
    ])
  })

  it('只有一条消息时原样发送，不 prepend 角色前缀', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    await collect(
      runtime(client).chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [{ role: 'user', content: '就一句' }],
      }),
    )
    expect(state.promptBlocks).toEqual([{ type: 'text', text: '就一句' }])
  })

  it('systemPrompt 前置在 content blocks 之前', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    await collect(
      runtime(client).chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [],
        systemPrompt: '你是批改助手',
        blocks: [
          { type: 'image', data: 'PNG', mimeType: 'image/png' },
          { type: 'text', text: '批改这份卷子' },
        ],
      }),
    )
    expect(state.promptBlocks).toEqual([
      { type: 'text', text: '你是批改助手' },
      { type: 'image', data: 'PNG', mimeType: 'image/png' },
      { type: 'text', text: '批改这份卷子' },
    ])
  })

  it('给了 blocks 就不再从 messages 取文本', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    await collect(
      runtime(client).chatStream({
        providerId: 'p',
        modelId: 'm',
        messages: [{ role: 'user', content: '不该被用到' }],
        blocks: [{ type: 'text', text: '用这个' }],
      }),
    )
    expect(state.promptBlocks).toEqual([{ type: 'text', text: '用这个' }])
  })

  it('多个 turn 复用同一子进程且各用独立 sessionId；dispose 关闭客户端', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    const rt = runtime(client)
    await collect(rt.chatStream(params('一')))
    await collect(rt.chatStream(params('二')))
    expect(state.initialized).toBe(1)
    expect(state.sessionIds).toHaveLength(2)
    expect(state.sessionIds[0]).not.toBe(state.sessionIds[1])
    await rt.dispose()
    expect(state.closed).toBe(1)
  })

  it('没有 turn/end 时不发 done；turn/end 到达才收尾并释放订阅', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => {
      emit(textMsg(sessionId, ['半句'], 1, 1))
    })
    const gen = runtime(client).chatStream(params())
    const types: (string | undefined)[] = []
    // text-chunks 记录展开为 text_start / text_delta / text_end，per-step done 被抑制
    for (let i = 0; i < 4; i++) types.push((await gen.next()).value?.type)
    expect(types).toEqual(['start', 'text_start', 'text_delta', 'text_end'])

    // 挂起中的 next()：异步生成器会把它排在 return() 之前，故只能靠 turn/end 放行
    const waiting = gen.next()
    const stillOpen = await Promise.race([
      waiting.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('pending'), 25)),
    ])
    expect(stillOpen).toBe('pending')

    state.sub?.deliver(turnEnd(state.sessionIds[0]))
    const tail = await waiting
    expect(tail.value?.type).toBe('done')
    // turnEvents 在 turn/end 被消费时就释放订阅（比旧实现更早，不再多等一个
    // yield）；done 由已累计的 usage 合成，不依赖订阅还活着。
    expect(state.sub?.closeCount).toBe(1)
    const end = await gen.next()
    expect(end.done).toBe(true)
    expect(state.sub?.closeCount).toBe(1)
  })

  it("turn/end reason='error' 以 error 事件结束，不伪装成「空成功」", async () => {
    const { client } = makeFake(({ sessionId, emit }) => {
      emit(notif(sessionId, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } }))
    })
    const out = await collect(runtime(client).chatStream(params()))
    expect(out.map((e) => e.type)).toEqual(['start', 'error'])
    expect(out[1]).toEqual({ type: 'error', message: DSH_TURN_ERROR, retryable: true })
  })

  it("turn/end reason='aborted' 保留已交付文本后以可重试 error 结束", async () => {
    const { client } = makeFake(({ sessionId, emit }) => {
      emit(textMsg(sessionId, ['半句'], 1, 1))
      emit(notif(sessionId, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } }))
    })
    const out = await collect(runtime(client).chatStream(params()))
    expect(out.map((e) => e.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_end',
      'error',
    ])
    expect(out[out.length - 1]).toEqual({
      type: 'error',
      message: DSH_TURN_ABORTED,
      retryable: true,
    })
  })
})

describe('createDshRuntime（生产唯一构造入口）', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('总是把关掉 harness 自带工具那层排在最前，调用方 patch 最后', async () => {
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'p',
      model: 'm',
      patches: ['/userData/eaa-mcp-main-1.cordis.patch.yml'],
    })
    // 白盒读取：这层顺序就是最小权限的落点，不能靠调用方自觉
    const patches = (rt as unknown as { opts: { patches: string[] } }).opts.patches
    expect(patches).toEqual([
      join(dir, EAA_HARDENING_PATCH_FILE),
      '/userData/eaa-mcp-main-1.cordis.patch.yml',
    ])
    expect(existsSync(patches[0])).toBe(true)
  })

  it('角色说明目录只注入这一次子进程的 DSH_AGENTS_HOME', () => {
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'p',
      model: 'm',
      agentsHome: join(dir, 'agents', 'main'),
    })
    const opts = (rt as unknown as { opts: { env: Record<string, string> } }).opts
    expect(opts.env.DSH_AGENTS_HOME).toBe(join(dir, 'agents', 'main'))
    expect(opts.env.PATH).toBe(process.env.PATH)
  })

  it('教育工具端点放进环境变量，不另写一份 mcp patch', () => {
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'p',
      model: 'm',
      mcp: { url: 'http://127.0.0.1:9/mcp/im-1', token: 'sekret' },
    })
    const opts = (rt as unknown as { opts: { patches: string[]; env: Record<string, string> } })
      .opts
    expect(opts.env.EAA_MCP_URL).toBe('http://127.0.0.1:9/mcp/im-1')
    expect(opts.env.EAA_MCP_TOKEN).toBe('sekret')
    expect(opts.env.PATH).toBe(process.env.PATH)
    expect(opts.patches.some((p) => p.includes('eaa-mcp-'))).toBe(false)
  })

  it('按插件注入地址时，没给的组不会连上操行端点', () => {
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'p',
      model: 'm',
      mcp: {
        env: { EAA_ROSTER_MCP_URL: 'http://127.0.0.1:9/mcp/roster', EAA_ROSTER_MCP_TOKEN: 'r' },
      },
    })
    const opts = (rt as unknown as { opts: { env: Record<string, string> } }).opts
    expect(opts.env.EAA_ROSTER_MCP_URL).toBe('http://127.0.0.1:9/mcp/roster')
    expect(opts.env.EAA_ROSTER_MCP_TOKEN).toBe('r')
    expect(opts.env.EAA_MCP_URL).toBeUndefined()
  })

  it('调用方不给 patch 时也只带关闭层', () => {
    const rt = createDshRuntime({ cwd: dir, provider: 'p', model: 'm' })
    expect((rt as unknown as { opts: { patches: string[] } }).opts.patches).toEqual([
      join(dir, EAA_HARDENING_PATCH_FILE),
    ])
  })

  it('有存过的 key 时注入环境变量，路由声明写进 sdk profile 层而不是 spawn --patch', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-test',
    })
    const sdkHome = join(dir, 'dsh-sdk-home')
    configureDshRuntime({ cwd: dir, sdkHome })
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'p',
      model: 'm',
      patches: ['/caller.yml'],
    })
    const opts = (rt as unknown as { opts: { patches: string[]; env: Record<string, string> } })
      .opts
    expect(opts.patches).toEqual([join(dir, EAA_HARDENING_PATCH_FILE), '/caller.yml'])
    expect(opts.patches.some((item) => item.includes('eaa-llm-providers'))).toBe(false)
    const profilePatch = readFileSync(join(sdkHome, 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8')
    expect(profilePatch).toContain('id: llm-pi-ai')
    expect(profilePatch).toContain('EAA_DSH_KIMI_API_KEY')
    expect(profilePatch).not.toContain('sk-test')
    // env 是整体替换语义，必须带上父环境
    expect(opts.env.PATH).toBe(process.env.PATH)
    expect(opts.env.EAA_DSH_KIMI_API_KEY).toBe('sk-test')
    configureDshRuntime({ cwd: dir })
    configureDshCredentials(null)
  })

  it('未保存的密钥只注入这一次，不写进共享 providers 文件', async () => {
    configureDshCredentials({
      listProviders: () => [],
      getApiKey: () => undefined,
    })
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'kimi',
      model: 'k2',
      probeCredential: { providerId: 'kimi', apiKey: 'sk-unsaved' },
    })
    const opts = (rt as unknown as { opts: { patches: string[]; env: Record<string, string> } })
      .opts
    expect(existsSync(join(dir, EAA_PROVIDER_PATCH_FILE))).toBe(false)
    const probe = opts.patches.find((p) => p.includes('eaa-llm-probe-'))
    expect(probe).toBeTruthy()
    expect(readFileSync(probe as string, 'utf8')).toContain('apiKeyEnv: EAA_DSH_KIMI_API_KEY')
    expect(opts.env.EAA_DSH_KIMI_API_KEY).toBe('sk-unsaved')
    await rt.dispose()
    expect(existsSync(probe as string)).toBe(false)
    configureDshCredentials(null)
  })

  it('已保存过密钥时，探测用的新 key 盖过密钥库里的那把', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-stored',
    })
    const rt = createDshRuntime({
      cwd: dir,
      provider: 'kimi',
      model: 'k2',
      probeCredential: { providerId: 'kimi', apiKey: 'sk-unsaved' },
    })
    const opts = (rt as unknown as { opts: { patches: string[]; env: Record<string, string> } })
      .opts
    expect(opts.env.EAA_DSH_KIMI_API_KEY).toBe('sk-unsaved')
    expect(opts.patches.some((p) => p.includes('eaa-llm-probe-'))).toBe(false)
    configureDshCredentials(null)
  })

  it('启动子进程只把 apiKeyEnv 合并进 profile，不把 EAA 钉住的 models 写进 DSH 目录', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-test',
    })
    const sdkHome = join(dir, 'dsh-sdk-home')
    configureDshRuntime({
      cwd: dir,
      sdkHome,
      routeModel: (route, id) =>
        route === 'kimi'
          ? {
              id,
              contextWindow: 200000,
              maxTokens: 8192,
              input: ['text', 'image'],
              api: 'openai-completions',
            }
          : undefined,
    })
    const rt = createDshRuntime({ cwd: dir, provider: 'kimi', model: 'k2-turbo' })
    const patches = (rt as unknown as { opts: { patches: string[] } }).opts.patches
    expect(patches.some((item) => item.includes('eaa-llm-providers.cordis.patch.yml'))).toBe(false)
    const text = readFileSync(join(sdkHome, 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: llm-pi-ai')
    expect(text).toContain('EAA_DSH_KIMI_API_KEY')
    expect(text).not.toContain('k2-turbo')
    expect(text).not.toContain('contextWindow: 200000')
    configureDshRuntime({ cwd: dir })
    configureDshCredentials(null)
  })

  it('自定义网关地址写入 sdk profile，模型目录仍不写进去', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-test',
      modelsSettings: () => ({
        customModels: { kimi: [{ baseUrl: 'https://gateway.school.local/v1' }] },
        retry: { providerTimeoutMs: 45000 },
      }),
    })
    const sdkHome = join(dir, 'dsh-sdk-home')
    configureDshRuntime({ cwd: dir, sdkHome })
    createDshRuntime({ cwd: dir, provider: 'kimi', model: 'k2-turbo' })
    const text = readFileSync(join(sdkHome, 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('baseURL: https://gateway.school.local/v1')
    expect(text).toContain('timeoutMs: 45000')
    expect(text).toContain('EAA_DSH_KIMI_API_KEY')
    expect(text).not.toContain('k2-turbo')
    expect(text).not.toContain('sk-test')
    configureDshRuntime({ cwd: dir })
    configureDshCredentials(null)
  })

  it('官方目录里有的路由不写 models，目录外的自建路由写下当前模型', () => {
    configureDshCatalogSource({
      listProviders: () => [{ id: 'kimi', name: 'Kimi' }],
      listModels: (id) =>
        id === 'kimi'
          ? [
              {
                id: 'k2',
                name: 'K2',
                api: 'openai-completions',
                contextWindow: 1,
                maxTokens: 1,
                input: ['text'],
                supportsReasoning: false,
                costPerInputToken: 0,
                costPerOutputToken: 0,
                costCacheRead: 0,
                costCacheWrite: 0,
                baseUrl: '',
              },
            ]
          : [],
    })
    configureDshCredentials({
      listProviders: () => ['kimi', 'school-gateway'],
      getApiKey: () => 'sk-test',
    })
    const sdkHome = join(dir, 'dsh-sdk-home')
    configureDshRuntime({
      cwd: dir,
      sdkHome,
      routeModel: (_route, id) => ({
        id,
        name: id,
        api: 'openai-completions',
        contextWindow: 8000,
        maxTokens: 2000,
        input: ['text'],
      }),
    })
    createDshRuntime({ cwd: dir, provider: 'kimi', model: 'k2' })
    createDshRuntime({ cwd: dir, provider: 'school-gateway', model: 'custom-1' })
    const text = readFileSync(join(sdkHome, 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: custom-1')
    expect(text).toContain('api: openai-completions')
    expect(text).not.toContain('id: k2')
    expect(text).not.toContain('sk-test')
    configureDshCatalogSource(null)
    configureDshRuntime({ cwd: dir })
    configureDshCredentials(null)
  })
})

describe('dshLaunchOptions', () => {
  it('无 patch 时只给 processCwd（不传 patches: undefined）', () => {
    expect(dshLaunchOptions({ cwd: '/tmp/app' })).toEqual({ processCwd: '/tmp/app' })
    expect(dshLaunchOptions({ cwd: '/tmp/app', patches: [] })).toEqual({ processCwd: '/tmp/app' })
    expect(dshLaunchOptions({ cwd: '/tmp/app', patches: [''] })).toEqual({
      processCwd: '/tmp/app',
    })
  })

  it('有序 patch 原样透传（dsh 按顺序应用，内部 patch 在下）', () => {
    expect(
      dshLaunchOptions({ cwd: '/tmp/app', patches: ['/p/eaa-mcp.cordis.patch.yml', '/p/x.yml'] }),
    ).toEqual({
      processCwd: '/tmp/app',
      patches: ['/p/eaa-mcp.cordis.patch.yml', '/p/x.yml'],
    })
  })

  it('extraModulesDir 注入 NODE_PATH（按需组件目录），已有值时续在后面', () => {
    configureDshRuntime({ cwd: process.cwd(), extraModulesDir: 'C:/data/dsh-extra-modules' })
    const env = dshLaunchOptions({ cwd: '/tmp/app', env: { FOO: '1' } }).env as Record<
      string,
      string
    >
    expect(env.NODE_PATH).toBe('C:/data/dsh-extra-modules')
    const chained = dshLaunchOptions({
      cwd: '/tmp/app',
      env: { FOO: '1', NODE_PATH: 'C:/other' },
    }).env as Record<string, string>
    expect(chained.NODE_PATH).toBe(`C:/other${delimiter}C:/data/dsh-extra-modules`)
    configureDshRuntime({ cwd: process.cwd() })
    const clean = dshLaunchOptions({ cwd: '/tmp/app', env: { FOO: '1' } }).env as Record<
      string,
      string
    >
    expect(clean.NODE_PATH).toBeUndefined()
  })
})

describe('子进程可启动性（Electron 宿主专属项）', () => {
  const versions = process.versions as { electron?: string }
  const realElectronVersion = versions.electron
  const parentEnv = { ...process.env }

  afterEach(() => {
    if (realElectronVersion === undefined) delete versions.electron
    else versions.electron = realElectronVersion
    configureDshRuntime({ cwd: process.cwd() })
  })

  it('在 Electron 主进程里必须带 ELECTRON_RUN_AS_NODE，否则起的是第二个 app 实例', () => {
    versions.electron = '43.2.0'
    const opts = dshLaunchOptions({ cwd: '/tmp/app' })
    expect((opts.env as Record<string, string>).ELECTRON_RUN_AS_NODE).toBe('1')
    // SDK 的 env 是整体替换语义，所以缺省时必须带全量父环境（PATH 掉了子进程就找不到 node/pwsh）
    expect((opts.env as Record<string, string>).PATH).toBe(process.env.PATH)
  })

  it('调用方给的凭据变量与 RUN_AS_NODE 共存，且不被整体覆盖', () => {
    versions.electron = '43.2.0'
    const opts = dshLaunchOptions({
      cwd: '/tmp/app',
      env: { ...parentEnv, DEEPSEEK_API_KEY: 'sk-x' },
    })
    const env = opts.env as Record<string, string>
    expect(env.DEEPSEEK_API_KEY).toBe('sk-x')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('纯 node 环境（vitest / 裸 node 探针）不注入这两个键，保持原语义', () => {
    delete versions.electron
    expect(dshLaunchOptions({ cwd: '/tmp/app' })).toEqual({ processCwd: '/tmp/app' })
  })

  it('toUnpackedAsarPath 只改归档段，普通路径原样', () => {
    const asar = join('C:', 'App', 'resources', 'app.asar', 'node_modules', 'x', 'bin.js')
    expect(toUnpackedAsarPath(asar)).toBe(
      join('C:', 'App', 'resources', 'app.asar.unpacked', 'node_modules', 'x', 'bin.js'),
    )
    const plain = join('C:', 'repo', 'node_modules', 'x', 'bin.js')
    expect(toUnpackedAsarPath(plain)).toBe(plain)
  })

  it('注入的 dshBin 以归档外真实路径交给 SDK', () => {
    configureDshRuntime({
      cwd: '/tmp/app',
      dshBin: join(
        'C:',
        'App',
        'resources',
        'app.asar',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      ),
    })
    expect(dshLaunchOptions({ cwd: '/tmp/app' }).dshBin).toBe(
      join(
        'C:',
        'App',
        'resources',
        'app.asar.unpacked',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      ),
    )
  })

  it('仓库内解析出的 dsh 入口必须真实存在（解不到就不是能用的包）', () => {
    const entry = resolveDshEntryPath(process.cwd())
    expect(entry).toBeDefined()
    expect(existsSync(entry as string)).toBe(true)
  })

  it('anchor 无依赖时返回 undefined，而不是把不存在的路径塞给 SDK', () => {
    expect(resolveDshEntryPath(join(tmpdir(), 'eaa-no-such-app-root'))).toBeUndefined()
  })
})

describe('initialize 定死的路由值', () => {
  it('maxTokens 与推理档要真的交给子进程握手，否则调用方的控费参数是空话', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    const rt = new DshRuntime({
      provider: 'p',
      model: 'm',
      maxTokens: 2048,
      reasoningEffort: 'high',
      createClient: async () => client,
    })
    await collect(rt.chatStream({ providerId: 'p', modelId: 'm', messages: [] }))
    expect(state.initParams).toEqual({
      cwd: expect.any(String),
      provider: 'p',
      model: 'm',
      maxTokens: 2048,
      reasoningEffort: 'high',
    })
  })

  it('未给 maxTokens/推理档时不塞 undefined 键（沿用 dsh 自己的默认）', async () => {
    const { client, state } = makeFake(({ sessionId, emit }) => emit(turnEnd(sessionId)))
    const rt = new DshRuntime({ provider: 'p', model: 'm', createClient: async () => client })
    await collect(rt.chatStream({ providerId: 'p', modelId: 'm', messages: [] }))
    expect(Object.keys(state.initParams as object).sort()).toEqual(['cwd', 'model', 'provider'])
  })

  it('换 maxTokens 即换 routeKey（上层据此换子进程）', () => {
    const a = dshPinnedKey({ provider: 'p', model: 'm', maxTokens: 512 })
    const b = dshPinnedKey({ provider: 'p', model: 'm', maxTokens: 1024 })
    const c = dshPinnedKey({ provider: 'p', model: 'm', reasoningEffort: 'high' })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('官方模型目录根', () => {
  it('catalogRoot 与 session cwd 分开：目录指向运行时而不是 userData', () => {
    const userData = join('/tmp', 'Education Advisor')
    const runtimeRoot = join(userData, 'dsh-bundles', 'dsh-runtime')
    configureDshRuntime({ cwd: userData, catalogRoot: runtimeRoot })
    expect(getDshCatalogRoot()).toBe(runtimeRoot)
  })

  it('retargetPackagedDsh 把目录根改到解压后的 dsh-runtime', () => {
    const userData = join('/tmp', 'Education Advisor')
    const extracted = join(userData, 'dsh-bundles', 'dsh-runtime')
    configureDshRuntime({ cwd: userData })
    expect(getDshCatalogRoot()).toBe(userData)
    retargetPackagedDsh(extracted)
    expect(getDshCatalogRoot()).toBe(extracted)
  })
})
