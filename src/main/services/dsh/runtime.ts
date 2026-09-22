// =============================================================
// dsh 运行时生命周期客户端
//
// 契约与 ChatStreamRunner.chatStream 对齐（同样 AsyncGenerator<StreamEvent>），
// 因此 IPC handler 与渲染端不区分后端。
//
// 只依赖本仓库自定义的 DshClientLike：@deepseek-ai/dsh-sdk-client 是
// pre-stable 且 ESM-only，编译期不引用它，由 loadSdkClient() 运行时装载，
// 测试注入假客户端即可。
// =============================================================

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import type { StreamEvent, TokenUsage } from '@shared/types/ai'
import { ensureEaaHardeningPatch } from './hardening'
import { type DshRouteModelSource, dshRouteModelEntry } from './profile-overrides'
import {
  dshProviderRouting,
  dshSubprocessEnv,
  ensureEaaProviderPatch,
  providersToDeclare,
} from './provider-patch'
import { mapDshSessionEvent } from './stream-mapper'
import type { DshSessionEvent, DshSessionEventNotification } from './wire-types'

/** dsh `session/prompt` 的 content block（文本路由只需 text） */
export interface DshPromptTextBlock {
  type: 'text'
  text: string
}

/**
 * dsh 只接受这四种栅格 mime（SdkEncodedImageBlock），且会在受理时校验；
 * 因此映射 pi 的 ImageContent(mimeType: string) 时必须显式收窄。
 */
export type DshImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface DshPromptImageBlock {
  type: 'image'
  /** 规范 base64 */
  data: string
  mimeType: DshImageMimeType
}

export type DshPromptBlock = DshPromptTextBlock | DshPromptImageBlock

export interface DshNotification {
  method: string
  params: Record<string, unknown>
}

/**
 * dsh NotificationSubscription 的公开面。
 * close() 会丢弃排队项并让挂起的 next() reject —— prompt 失败正靠它解阻塞。
 */
export interface DshSubscriptionLike {
  next(): Promise<DshNotification>
  close(): void
}

/** @deepseek-ai/dsh-sdk-client 的 HarnessClient 中被本模块使用的子集 */
export interface DshClientLike {
  initialize(params: {
    cwd: string
    provider: string
    model: string
    maxTokens?: number
    reasoningEffort?: string
  }): Promise<unknown>
  prompt(sessionId: string, blocks: readonly DshPromptBlock[]): Promise<unknown>
  /** filter 是纯谓词，不是数据回调；事件只从 subscription 取 */
  subscribe(filter: (n: DshNotification) => boolean): DshSubscriptionLike
  close(): Promise<void>
}

export interface DshChatStreamParams {
  providerId: string
  modelId: string
  messages: Array<{ role: string; content: string }>
  /**
   * 直接给定 prompt content blocks（文本/图片混排）。
   * 给了就不再从 messages 取文本 —— 试卷识别的图像输入必须走这条，
   * 否则 lastUserText 会把图片静默丢掉。
   */
  blocks?: DshPromptBlock[]
  /**
   * dsh 由 dsh-system-prompt 插件把系统提示渲染成 surface node 0，
   * SDK 的 session/prompt 没有 system 角色入参；因此这里显式带过来时
   * 作为首个 text block 前置进 prompt，行为可在 session log 里复核。
   */
  systemPrompt?: string
  maxTokens?: number
  /**
   * 本轮不生效：SDK 无按请求覆盖推理档位的入口，reasoningEffort 只在 initialize
   * 定死。上层（pi-ai-service）把它带进子进程构造，换档位即换子进程；
   * 保留该字段同时为了与 ChatStreamRunner.chatStream 的参数签名兼容。
   */
  thinking?: string
}

/**
 * 装载 dsh SDK。
 *
 * `new Function` 是必需的：主进程构建成 CJS，打包器会把字面量 `import()`
 * 降级成 `require()`，而该包只有 ESM 出口（"type":"module"）。函数体对打包器
 * 不可见，运行时仍是真正的动态 import；也避免未安装依赖时构建期解析失败。
 */
export async function loadSdkClient(): Promise<new (options: unknown) => DshClientLike> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    s: string,
  ) => Promise<{ HarnessClient: new (options: unknown) => DshClientLike }>
  const mod = await dynamicImport('@deepseek-ai/dsh-sdk-client')
  return mod.HarnessClient
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * dsh 子进程的工作目录（session log 落点）。
 * 由 bootstrap 注入 app.getPath('userData')：services 层不直接依赖 electron，
 * 现有单测在无 electron 环境的 node 项目里跑 piAIService，import 它会炸。
 */
let runtimeCwd = process.cwd()

/**
 * dsh 可执行入口（`@deepseek-ai/dsh` 的 bin），由 bootstrap 注入。
 * 不注入时 SDK 自己 resolve —— 主进程在 app.asar 里时它 resolve 到的是 asar 内路径，
 * 纯 node 子进程读不到（见 toUnpackedAsarPath），所以打包态必须注入。
 */
let runtimeDshBin: string | undefined

/**
 * 「路由名 + 模型 id → app 目录里的那个模型」，由 bootstrap 注入（pi-ai 的
 * resolveModel）。patch 需要它来给钉住的那条路由补 models 条目：实测 dsh 的
 * llm-pi-ai 路由不沿用 pi 现成目录，缺条目就是 has no configured model。
 */
type DshRouteModelLookup = (route: string, modelId: string) => DshRouteModelSource | undefined
let runtimeRouteModel: DshRouteModelLookup | undefined

export function configureDshRuntime(opts: {
  cwd: string
  dshBin?: string
  routeModel?: DshRouteModelLookup
}): void {
  runtimeCwd = opts.cwd
  // 无条件覆盖：整次装配只有一个调用方，缺省即「没有可用入口」，不能沿用上一次的值
  runtimeDshBin = opts.dshBin
  runtimeRouteModel = opts.routeModel
}
export function getDshRuntimeCwd(): string {
  return runtimeCwd
}

/**
 * `app.asar` → `app.asar.unpacked`：electron-builder 的 asarUnpack 把匹配文件解到
 * 归档**外面**的同名目录，而 Electron 的模块解析器仍返回归档内路径。
 * 主进程自己读无所谓（fs 补丁透明），但 SDK 用 process.execPath 另起的是纯 node
 * 子进程，归档对它不可见 —— 交给它的每个路径都得是真实磁盘路径。
 */
export function toUnpackedAsarPath(p: string): string {
  return p.split(`${sep}app.asar${sep}`).join(`${sep}app.asar.unpacked${sep}`)
}

/**
 * 算出「node 子进程能真的打开」的 dsh 入口路径。anchor 由 bootstrap 给
 * （app.getAppPath()：dev 是仓库根，打包态是 resources/app.asar）。
 *
 * 解析不到就返回 undefined 而不是抛错：那属于装配问题，交给第一次 AI 调用带
 * 着 dsh 的原始错误报出来，比启动期把 app 卡死好。
 */
export function resolveDshEntryPath(anchorDir: string): string | undefined {
  try {
    const req = createRequire(join(anchorDir, 'package.json'))
    const manifestPath = req.resolve('@deepseek-ai/dsh/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      bin?: string | Record<string, string>
    }
    const bin = typeof manifest.bin === 'object' ? manifest.bin?.dsh : manifest.bin
    if (typeof bin !== 'string' || !bin) return undefined
    const entry = toUnpackedAsarPath(join(dirname(manifestPath), bin))
    return existsSync(entry) ? entry : undefined
  } catch {
    return undefined
  }
}

/** 主进程跑在 Electron 里（dev 与打包态都是）＝ process.execPath 是 Electron 二进制 */
export function isElectronMainProcess(): boolean {
  return Boolean(process.versions.electron)
}

/**
 * 子进程 initialize 定死的那组路由值 → 唯一标识。换其中任何一个都得换子进程。
 * 上层缓存 dsh 运行时时必须用同一个函数算键，否则缓存与 routeKey 会各说各话。
 */
export function dshPinnedKey(opts: {
  provider: string
  model: string
  maxTokens?: number
  reasoningEffort?: string
  configFingerprint?: string
}): string {
  return [
    opts.provider,
    opts.model,
    opts.maxTokens ?? '',
    opts.reasoningEffort ?? '',
    opts.configFingerprint ?? '',
  ].join('\u0000')
}

function sessionIdOf(n: DshNotification): string | undefined {
  return (n.params as Partial<DshSessionEventNotification> | undefined)?.sessionId
}

/**
 * SDK 子进程的启动参数。
 * 单独抽出以便在 vitest 里断言（真实构造路径要 import ESM，见 sdk-integration
 * 测试里对 SSR dynamic import 限制的说明）。
 *
 * patches 为空时整个键省略：dsh 侧按「内部 patch 在下、调用方 patch 在上」的顺序应用。
 *
 * 两个 Electron 专属项（缺一，装了出来的 app 每次 AI 调用都起不来）：
 * - ELECTRON_RUN_AS_NODE：SDK 用 process.execPath 起子进程，在 Electron 主进程里
 *   那是 app 自己的 exe。不带这个变量，起的是「第二个应用实例」而不是 node ——
 *   实测子进程 30s 不退出、零输出，initialize 只能超时。
 * - dshBin：归档内路径对纯 node 子进程不可见，必须换成 app.asar.unpacked 的真实路径。
 */
export function dshLaunchOptions(opts: {
  cwd: string
  patches?: string[]
  env?: Record<string, string>
}): Record<string, unknown> {
  const patches = opts.patches?.filter(Boolean) ?? []
  const base: Record<string, unknown> = patches.length
    ? { processCwd: opts.cwd, patches }
    : { processCwd: opts.cwd }
  // SDK 的 env 是整体替换语义，所以要么原样省略（沿用继承），要么带全量环境
  if (isElectronMainProcess()) {
    base.env = {
      ...(opts.env ?? (process.env as Record<string, string>)),
      ELECTRON_RUN_AS_NODE: '1',
    }
  } else if (opts.env) {
    base.env = opts.env
  }
  const bin = runtimeDshBin ? toUnpackedAsarPath(runtimeDshBin) : undefined
  if (bin) base.dshBin = bin
  return base
}

/**
 * 生产路径唯一该用的构造入口：任何 dsh 子进程都先带上「关掉 harness 自带工具」
 * 那一层 patch，再带上「把 app 存过 key 的 provider 声明成 dsh 路由」那一层，
 * 最后才是调用方自己的层（agent 的 MCP 挂载）。少第一层，子进程就自带
 * bash/写文件/subagent；少第二层，initialize 会报 no adapter registered /
 * MISSING_CREDENTIAL —— 因为 dsh 的路由与凭据本来都要在它自己的配置里声明。
 *
 * patch 层顺序是 bundle → profile → --patch 且同 id 后写覆盖
 * （packages/boot/app-boot/src/profile.ts:11-13），所以调用方 patch 排在最后、
 * 优先级最高。
 *
 * 单测直接 new DshRuntime(createClient) 打桩，不必落盘。
 */
export function createDshRuntime(
  opts: Omit<ConstructorParameters<typeof DshRuntime>[0], 'patches'> & { patches?: string[] },
): DshRuntime {
  const cwd = opts.cwd ?? runtimeCwd
  const hardening = ensureEaaHardeningPatch(cwd)
  // 钉住的那条路由要带 models 条目，否则子进程握手成功但一发请求就报
  // has no configured model（dsh 的 llm-pi-ai 路由不沿用 pi 目录，实测 2026-09-22）
  const pinnedEntry = dshRouteModelEntry(runtimeRouteModel?.(opts.provider ?? '', opts.model ?? ''))
  const routing = dshProviderRouting(
    providersToDeclare(),
    pinnedEntry && opts.provider ? { route: opts.provider, entry: pinnedEntry } : undefined,
  )
  const providerPatch = ensureEaaProviderPatch(cwd, routing.profiles)
  return new DshRuntime({
    ...opts,
    patches: [hardening, ...(providerPatch ? [providerPatch] : []), ...(opts.patches ?? [])],
    env: dshSubprocessEnv(routing.envNames),
  })
}

export class DshRuntime {
  private client: DshClientLike | null = null
  private starting: Promise<DshClientLike> | null = null
  private sessionSeq = 0
  private activeTurns = 0
  private idleGate: { promise: Promise<void>; release: () => void } = DshRuntime.openIdleGate()

  private static openIdleGate() {
    let release = () => {}
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }

  constructor(
    private readonly opts: {
      /** 省略时用 configureDshRuntime 注入的目录 */
      cwd?: string
      /**
       * initialize 是进程级握手，provider/model 由此一次性定死路由；
       * 跨 turn 换模型需要单独进程或等 dsh 暴露切换方法（SDK 目前无）。
       */
      provider?: string
      model?: string
      /**
       * 输出上限与推理档位同样在 initialize 定死（SDK 的 session/prompt 只有
       * content blocks，没有按请求覆盖的入口）。不在这里带上，调用方传的
       * maxTokens / thinking 就会被静默丢弃 —— 批改的控费与界面的推理档都会失效。
       */
      maxTokens?: number
      reasoningEffort?: string
      /**
       * 该 provider 的「凭据 + 路由配置」指纹（dshRouteFingerprint 算）。
       * key 与 baseURL/retry 都是 spawn 时经 env 与 patch 定死的，SDK 没有按请求
       * 换的入口 —— 不带进 pinned key，用户改了 key 或 Base URL 会继续用旧进程旧配置。
       */
      configFingerprint?: string
      /** 注入点：测试用假客户端；默认装载真实 SDK */
      createClient?: () => Promise<DshClientLike>
      /** 有序 cordis profile patch 文件（如 tool-bridge 生成的 eaa MCP 挂载） */
      patches?: string[]
      /**
       * 子进程环境。SDK 语义是**整体替换**父环境，所以由 createDshRuntime 负责
       * 合并出完整映射；省略即沿用 SDK 的默认继承。
       */
      env?: Record<string, string>
    },
  ) {}

  private get cwd(): string {
    return this.opts.cwd ?? runtimeCwd
  }

  /**
   * initialize 定死的路由。SDK 没有按请求换 provider/model/maxTokens/推理档的入口，
   * 所以调用方要换其中任何一个只能换子进程 —— 暴露这个键就是为了让上层据此重建。
   */
  get routeKey(): string {
    return dshPinnedKey({
      provider: this.opts.provider ?? '',
      model: this.opts.model ?? '',
      maxTokens: this.opts.maxTokens,
      reasoningEffort: this.opts.reasoningEffort,
      configFingerprint: this.opts.configFingerprint,
    })
  }

  /** 同一运行时只握手一次，多个 turn 复用同一子进程 */
  private start(): Promise<DshClientLike> {
    if (this.client) return Promise.resolve(this.client)
    if (!this.starting) {
      this.starting = (async () => {
        const client = this.opts.createClient
          ? await this.opts.createClient()
          : new (await loadSdkClient())(
              dshLaunchOptions({
                cwd: this.cwd,
                patches: this.opts.patches,
                env: this.opts.env,
              }),
            )
        await client.initialize({
          cwd: this.cwd,
          provider: this.opts.provider ?? '',
          model: this.opts.model ?? '',
          ...(this.opts.maxTokens === undefined ? {} : { maxTokens: this.opts.maxTokens }),
          ...(this.opts.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: this.opts.reasoningEffort }),
        })
        this.client = client
        return client
      })()
      this.starting.catch(() => {
        this.starting = null
      })
    }
    return this.starting
  }

  /** dsh 对未知 id 惰性创建 agent+session，故每个 turn 用新 id */
  private nextSessionId(): string {
    this.sessionSeq += 1
    return `eaa-${Date.now()}-${this.sessionSeq}`
  }

  /**
   * 对话历史 → 一段文本。
   *
   * SDK 的 session/prompt 没有「多条消息 + 角色」的入口，每个 turn 又是新 session
   * （dsh 对未知 id 惰性建 session），所以历史不会由 dsh 侧持有 —— 只发最后一条
   * user 文本等于「多轮对话没有上下文」。这里按出现顺序渲染整段对话。
   *
   * 只有一条消息时原样发送，不加角色前缀：绝大多数单轮调用（含首条提问）的 prompt
   * 内容因此逐字不变。
   */
  private static renderTranscript(messages: ReadonlyArray<{ role: string; content: string }>) {
    if (messages.length === 0) return ''
    if (messages.length === 1) return messages[0].content
    return messages
      .filter((m) => m.content.length > 0)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')
  }

  private static buildBlocks(params: DshChatStreamParams): DshPromptBlock[] {
    const blocks: DshPromptBlock[] = []
    if (params.systemPrompt) blocks.push({ type: 'text', text: params.systemPrompt })
    if (params.blocks?.length) blocks.push(...params.blocks)
    else blocks.push({ type: 'text', text: DshRuntime.renderTranscript(params.messages) })
    return blocks
  }

  /**
   * 一轮 turn 的原始 SessionEvent 流，turn/end 后结束。
   * chatStream（渲染端 StreamEvent）与 agent 执行链路（AgentEvent）都从这里取数，
   * 避免同一份 dsh 事件被两套逻辑各自解析。
   */
  async *turnEvents(params: DshChatStreamParams): AsyncGenerator<DshSessionEvent> {
    this.activeTurns += 1
    try {
      for await (const event of this.rawTurnEvents(params)) yield event
    } finally {
      this.activeTurns -= 1
      if (this.activeTurns === 0) {
        const gate = this.idleGate
        this.idleGate = DshRuntime.openIdleGate()
        gate.release()
      }
    }
  }

  /** 是否有 turn 正在进行（换路由时用来避免误杀流式中的会话） */
  get busy(): boolean {
    return this.activeTurns > 0
  }

  private async *rawTurnEvents(params: DshChatStreamParams): AsyncGenerator<DshSessionEvent> {
    const client = await this.start()
    const sessionId = this.nextSessionId()
    const sub = client.subscribe(
      (n) => n.method === 'session.event' && sessionIdOf(n) === sessionId,
    )

    let promptError: Error | null = null
    void Promise.resolve(client.prompt(sessionId, DshRuntime.buildBlocks(params)))
      .then(() => undefined)
      .catch((err: unknown) => {
        promptError = toError(err)
        // 唤醒仍等事件的 next()，否则会永久挂起
        sub.close()
      })

    try {
      for (;;) {
        let notification: DshNotification
        try {
          notification = await sub.next()
        } catch (err) {
          throw promptError ?? toError(err)
        }
        const event = (notification.params as unknown as DshSessionEventNotification)
          .event as DshSessionEvent
        yield event
        if (event.type === 'turn/end') break
      }
      if (promptError) throw promptError
    } finally {
      sub.close()
    }
  }

  /**
   * 流式对话。一次 turn 可能有多个 step（模型调用 + 其工具执行），
   * 每个 assistant/message 各带 usage，因此这里累加、只在 turn/end 发一个
   * done；中途的 done 不透出（渲染端以 done 收尾）。
   */
  async *chatStream(params: DshChatStreamParams): AsyncGenerator<StreamEvent> {
    yield { type: 'start', model: params.modelId, provider: params.providerId }

    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    let turnFailed = false

    for await (const event of this.turnEvents(params)) {
      // 先映射再判收尾：turn/end 的 aborted/error 由 mapper 翻成 error 事件；
      // error 事件按流透出（渲染端据此提示重试），其后不再补 done。
      for (const mapped of mapDshSessionEvent(event)) {
        if (mapped.type === 'done') {
          usage.inputTokens += mapped.usage.inputTokens
          usage.outputTokens += mapped.usage.outputTokens
          usage.cacheReadTokens += mapped.usage.cacheReadTokens
          usage.cacheWriteTokens += mapped.usage.cacheWriteTokens
          continue
        }
        if (mapped.type === 'error') turnFailed = true
        yield mapped
      }
    }
    if (!turnFailed) yield { type: 'done', usage, cost: 0 }
  }

  async dispose(): Promise<void> {
    const client = this.client
    this.client = null
    this.starting = null
    if (client) await client.close()
  }

  /** 等本轮 turn 收尾后再关停（SDK 关停没有「只停这一轮」的粒度） */
  async disposeWhenIdle(): Promise<void> {
    while (this.activeTurns > 0) await this.idleGate.promise
    await this.dispose()
  }
}
