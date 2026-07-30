// =============================================================
// FeishuBotService — 飞书长连接机器人服务
//
// 使用 @larksuiteoapi/node-sdk 的 WSClient(长连接模式)接收飞书消息,
// 无需公网地址/内网穿透。收到消息后:
//   - / 开头 → FeishuCommandRouter(斜杠命令)
//   - 否则   → 默认 Agent(main)对话,完成后把回复发回飞书
//
// 状态通过 EventEmitter 推送('status' 事件),供设置页徽章实时显示。
// 密钥从不持久化在本模块,每次 start 由调用方从 keystore 读取传入。
// =============================================================

import { EventEmitter } from 'node:events'
import * as lark from '@larksuiteoapi/node-sdk'
import { type BrowserWindow, powerMonitor } from 'electron'
import { log } from '../utils/logger'
import { agentService } from './agent-service'
import { eaaBridge, getErrorMessage } from './eaa-bridge'
import {
  type CommandContext,
  createDefaultRouter,
  type FeishuCommandRouter,
} from './feishu-command-router'
import { extractText } from './feishu-message-utils'
import type { FeishuDomain } from './feishu-service'

export type BotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface BotStatusInfo {
  status: BotStatus
  appId?: string
  /** 上次错误信息(status === 'error' 时有值) */
  error?: string
  /** 已连接的时长(ms 时间戳),status === 'connected' 时有值 */
  connectedAt?: number
  /** 正在处理的消息数(诊断用) */
  processingCount?: number
  /** 排队中 + 处理中的消息总数(诊断用) */
  pendingCount?: number
}

const DEFAULT_AGENT_ID = 'main'
/** 飞书单条文本消息内容上限(字符),超出截断 */
const REPLY_CHAR_LIMIT = 4000
/** 飞书 App ID 格式(SDK 内部也按此校验,但仅打日志不抛错,会导致"假连接"永远停在连接中) */
const APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/
/** 待处理消息(排队中 + 处理中)上限,超出回"繁忙"并丢弃,防止队列无限增长 */
const MAX_PENDING_MESSAGES = 16
/** 已处理 message_id 去重缓存上限(飞书至少一次投递,ack 超时/网络抖动会重投) */
const DEDUP_CACHE_SIZE = 500
/** 守护重启最大连续尝试次数,超过则标记 error 等待人工介入 */
const MAX_GUARD_ATTEMPTS = 8

/**
 * fetch-based HTTP 实例,替代 SDK 默认的 axios。
 *
 * 必要性:axios 1.13.x 在 Node 22+/26 上存在兼容性 bug,部分 HTTPS 请求
 * 会返回 400(尤其是飞书长连接 endpoint /callback/ws/endpoint)。Node 内置的
 * fetch 没有此问题。这里实现 SDK 期望的 HttpInstance 接口(7 个方法),
 * 全部用 fetch 绕过 axios。
 */
/**
 * 当前飞书域名 base,由 start() 根据 domain 设置(单例,同一时刻仅一个域名活跃)。
 * fetchRequest / validateCredentials 在调用时读取此值,故 start() 中先赋值再发请求。
 * - feishu: https://open.feishu.cn
 * - lark:   https://open.larksuite.com
 */
let feishuBase = 'https://open.feishu.cn'

interface FetchOpts {
  url?: string
  method?: string
  headers?: Record<string, string>
  data?: unknown
  params?: Record<string, string>
}

async function fetchRequest<T>(opts: FetchOpts): Promise<T> {
  let url = opts.url || ''
  if (!url.startsWith('http')) {
    url = `${feishuBase}${url}`
  }
  if (opts.params) {
    const qs = new URLSearchParams(opts.params).toString()
    url = `${url}${url.includes('?') ? '&' : '?'}${qs}`
  }
  const method = (opts.method || 'get').toUpperCase()
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined,
    signal: AbortSignal.timeout(15000), // 15s 超时,防止飞书服务器无响应时请求无限挂起
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

const fetchHttpInstance = {
  request: <T = unknown>(opts: FetchOpts) => fetchRequest<T>(opts),
  get: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'get' }),
  delete: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'delete' }),
  head: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'head' }),
  options: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'options' }),
  post: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'post', data }),
  put: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'put', data }),
  patch: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'patch', data }),
}

/**
 * im.message.receive_v1 事件的数据结构(内联定义,避免依赖 SDK 内部命名空间)。
 * 仅声明本模块用到的字段。
 */
interface FeishuMessageEvent {
  message?: {
    message_id: string
    chat_id: string
    chat_type: string // 'p2p' | 'group'
    message_type: string
    content: string // JSON 字符串,如 {"text":"hello"}
    mentions?: Array<{ key: string; name: string; id?: Record<string, string | undefined> }>
  }
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string }
    sender_type?: string
  }
}

/**
 * 飞书机器人服务(单例)。
 * 通过 start/stop 控制长连接生命周期,状态变化 emit 'status' 事件。
 */
class FeishuBotService extends EventEmitter {
  private client: lark.WSClient | null = null
  private sdkClient: lark.Client | null = null
  private router: FeishuCommandRouter
  private currentStatus: BotStatus = 'idle'
  private currentAppId?: string
  private lastError?: string
  private connectedAt?: number
  /** 运行中的消息处理计数,用于诊断并发 */
  private processingCount = 0
  /**
   * B6-4 修复: 消息处理串行队列尾指针。
   * 飞书消息可能并发到达,但底层 agentService.runAgent 对同一 agent 有"已在运行"守卫
   * (会抛 "Agent is already running"),且共享的 getHistory 会让并发消息交叉拿到对方的回复。
   * 用 Promise 链把消息处理串行化,彻底消除竞态。
   */
  private messageQueueTail: Promise<void> = Promise.resolve()
  /** 用户手动停止标志:阻止"保存即重连"自动重启与守护重启 */
  private userStopped = false
  /** H3: 排队中 + 处理中的消息总数,配合 MAX_PENDING_MESSAGES 限流 */
  private pendingMessages = 0
  /** H3: 已处理 message_id 去重缓存(飞书至少一次投递,重投 id 相同) */
  private seenMessageIds: Set<string> = new Set()
  private seenMessageOrder: string[] = []
  /** M1/M4: 守护重启状态 — eventDispatcher 留存用于重连,attempts/退避控制 */
  private eventDispatcher: lark.EventDispatcher | null = null
  private guardAttempts = 0
  private nextGuardRetryAt = 0
  private restarting = false

  constructor() {
    super()
    // L-8 修复: 提高 maxListeners 上限,避免多模块监听 'status' 事件时触发 MaxListenersExceededWarning
    this.setMaxListeners(20)
    this.router = createDefaultRouter()
  }

  /** 当前状态快照 */
  getStatus(): BotStatusInfo {
    return {
      status: this.currentStatus,
      appId: this.currentAppId,
      error: this.lastError,
      connectedAt: this.connectedAt,
      processingCount: this.processingCount,
      pendingCount: this.pendingMessages,
    }
  }

  /**
   * 启动飞书长连接机器人。
   * @param appId     飞书应用 App ID
   * @param appSecret 飞书应用 App Secret(从 keystore 读取,不在此持久化)
   * @param win       主窗口(用于 agentService.runAgent 的状态推送)
   * @param domain    域名版本: 'feishu' 国内版 / 'lark' 国际版(默认 feishu)
   */
  async start(
    appId: string,
    appSecret: string,
    win: BrowserWindow | null,
    domain: FeishuDomain = 'feishu',
  ): Promise<void> {
    // 根据域名版本设置 base(单例:fetchRequest / validateCredentials 读取此模块级变量)
    feishuBase = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
    // SDK 使用的 Domain 枚举
    const larkDomain = domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu
    // 已在运行且 appId 相同 → 跳过
    if (this.client && this.currentAppId === appId && this.currentStatus === 'connected') {
      log('info', 'feishu-bot', `already connected with appId=${appId}, skip`)
      return
    }
    // 先停掉旧连接(appId 可能变了)。M3 修复: 内部重启不算"用户手动停止"
    if (this.client) {
      await this.stop({ userInitiated: false })
    }
    // 用户手动启动(或保存新凭证触发的自动重连),清除停止标志。
    // M3 修复: 必须在内部 stop 之后清除 — stop() 默认会置位 userStopped
    this.userStopped = false

    if (!appId || !appSecret) {
      this.setStatus('idle', { error: 'appId 或 appSecret 为空' })
      return
    }
    // H1 修复: appId 格式预检 — SDK 的 WSClient.start 对格式错误只打日志不抛错,
    // 会停在"连接中"假状态,这里直接给出明确错误
    if (!APP_ID_PATTERN.test(appId)) {
      this.setStatus('error', { error: 'App ID 格式不正确(应为 cli_ 开头的应用 ID)' })
      log('error', 'feishu-bot', `invalid appId format: ${appId.slice(0, 12)}...`)
      return
    }

    this.currentAppId = appId
    this.setStatus('connecting')

    // H1 修复: 显式鉴权预检(tenant_access_token),错误凭证立即报错而非无限"连接中"
    const credError = await this.validateCredentials(appId, appSecret)
    if (credError) {
      this.setStatus('error', { error: credError })
      log('error', 'feishu-bot', `credential validation failed: ${credError}`)
      return
    }
    this.guardAttempts = 0
    this.nextGuardRetryAt = 0

    // 构造命令上下文(注入 EAA + Agent 能力)
    const ctx: CommandContext = {
      runEAA: async (command, args = []) => {
        return eaaBridge.execute({ command, args })
      },
      listAgents: () =>
        agentService
          .listAgents()
          .filter((a) => a.enabled)
          .map((a) => ({ id: a.id, name: a.name, description: a.description })),
      runAgent: (prompt) => this.runAgentAndCollect(prompt, win),
    }

    // 事件分发器:注册消息接收事件(register 接收单个 handles 对象)
    const eventDispatcher = new lark.EventDispatcher({
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      'im.message.receive_v1': (data: FeishuMessageEvent) => {
        // H3 修复: 不在事件回调里 await 处理完成 — SDK 在 dispatcher.invoke 返回后才发 ack,
        // agent 运行可达数分钟,阻塞 ack 会致飞书服务器超时重投(消息被重复处理)。
        const messageId = data.message?.message_id
        // H3 修复: 去重 — 飞书至少一次投递,重投的 message_id 相同,直接跳过
        if (messageId && this.seenMessageIds.has(messageId)) {
          log('info', 'feishu-bot', `duplicate message ${messageId}, skip`)
          return
        }
        if (messageId) this.rememberMessageId(messageId)

        // H3 修复: 排队深度上限,防止突发消息撑爆内存/回复严重滞后
        if (this.pendingMessages >= MAX_PENDING_MESSAGES) {
          log('warn', 'feishu-bot', `pending queue full (${this.pendingMessages}), drop message`)
          if (messageId) {
            void this.reply(messageId, '当前消息处理繁忙,请稍后再发。').catch(() => {})
          }
          return
        }
        this.pendingMessages++
        this.messageQueueTail = this.messageQueueTail
          .catch(() => {})
          .then(async () => {
            try {
              await this.handleMessage(data, ctx)
            } catch (err) {
              log('error', 'feishu-bot', `message handler error: ${err}`)
            } finally {
              this.pendingMessages--
            }
          })
        // 立即返回(不 await 队列),让 SDK 立刻 ack
      },
    })
    // M1: 留存 dispatcher,守护重启时复用
    this.eventDispatcher = eventDispatcher

    // SDK Client:用于按 message_id 回复消息
    // httpInstance 用 fetch 实现,绕过 axios 在高版本 Node 上的 400 bug
    this.sdkClient = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: larkDomain,
      httpInstance: fetchHttpInstance,
    })

    // 长连接客户端(eventDispatcher 在 start() 时传入,不在构造时)
    // 通过回调跟踪 SDK 内部连接状态,正确反映 connecting/connected/重连
    // httpInstance 用 fetch 实现(同上,绕过 axios 400 bug)
    this.client = new lark.WSClient({
      appId,
      appSecret,
      domain: larkDomain,
      httpInstance: fetchHttpInstance,
      loggerLevel: lark.LoggerLevel.warn,
      autoReconnect: true,
      // M2 修复: 系统休眠后 TCP 半开连接不触发 close 事件,SDK 无感知。
      // pingTimeout: 发出 ping 后 120s 无任何入站帧 → 判定连接死亡,自动走重连
      wsConfig: { pingTimeout: 120 },
      // 握手 15s 超时,防止 stuck DNS/代理/NAT 导致握手无限挂起
      handshakeTimeoutMs: 15_000,
      onReady: () => {
        // 首次 WebSocket 握手成功
        this.connectedAt = Date.now()
        this.lastError = undefined
        this.guardAttempts = 0
        this.setStatus('connected')
        log('info', 'feishu-bot', `connected, appId=${appId}`)
      },
      onError: (err: Error) => {
        // M1 修复: SDK 重试耗尽(state→failed)。不直接定死 error,
        // 交给 status polling 的守护重启(指数退避);真正放弃时才转 error
        log('warn', 'feishu-bot', `ws retries exhausted: ${err.message}, guard will restart`)
        this.setStatus('connecting')
      },
      onReconnecting: () => {
        this.setStatus('connecting')
        log('info', 'feishu-bot', 'reconnecting...')
      },
      onReconnected: () => {
        this.connectedAt = Date.now()
        this.guardAttempts = 0
        this.setStatus('connected')
        log('info', 'feishu-bot', 'reconnected')
      },
    })

    // M2 修复: 监听系统休眠唤醒,立即重建连接(不等 pingTimeout 120s 兜底)
    this.attachResumeListener()

    try {
      // start() 在首次握手后 resolve,但实际连接状态由回调驱动。
      // 若 start 本身抛错(如网络不可达),标记 error。
      await this.client.start({ eventDispatcher })
      // resolve 后若状态仍是 connecting(后台未配置事件订阅时会持续重连),
      // 启动一个轮询,在真正连上、failed 守护重启或长时间失败后更新可见状态。
      this.startStatusPolling()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', { error: msg })
      log('error', 'feishu-bot', `start failed: ${msg}`)
      // 清理半初始化的 client,允许后续重试
      this.client = null
      this.sdkClient = null
    }
  }

  /**
   * H1 修复: 启动前校验 appId/appSecret 是否有效(请求 tenant_access_token)。
   * SDK 的 WSClient 对非法凭证只会在后台无限重试,状态永远停在"连接中"(假连接)。
   * 这里先做一次显式鉴权,失败立即给出明确错误。返回 null 表示凭证有效。
   */
  private async validateCredentials(appId: string, appSecret: string): Promise<string | null> {
    try {
      const res = await fetch(`${feishuBase}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json()) as { code?: number; msg?: string }
      if (data.code === 0) return null
      return `appId/appSecret 校验失败(code=${data.code}): ${data.msg ?? '未知错误'}`
    } catch (err) {
      return `凭证校验请求失败: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /** H3: message_id 去重缓存(FIFO,上限 DEDUP_CACHE_SIZE) */
  private rememberMessageId(id: string): void {
    this.seenMessageIds.add(id)
    this.seenMessageOrder.push(id)
    if (this.seenMessageOrder.length > DEDUP_CACHE_SIZE) {
      const oldest = this.seenMessageOrder.shift()
      if (oldest) this.seenMessageIds.delete(oldest)
    }
  }

  /** M2: 系统从休眠唤醒时的处理 — 立即重建连接 */
  private readonly handleSystemResume = (): void => {
    if (!this.client || this.userStopped) return
    log('info', 'feishu-bot', 'system resumed from sleep, forcing ws reconnect')
    // 睡眠期间 socket 可能已静默死亡而状态仍显示 connected;主动重建立即恢复收发
    this.setStatus('connecting')
    void this.restartClient('system-resume')
  }

  private attachResumeListener(): void {
    try {
      powerMonitor?.on('resume', this.handleSystemResume)
    } catch {
      /* 非 Electron 环境(测试/sidecar)忽略 */
    }
  }

  private detachResumeListener(): void {
    try {
      powerMonitor?.removeListener('resume', this.handleSystemResume)
    } catch {
      /* ignore */
    }
  }

  /**
   * M1/M2: 重启 WS 客户端(close + start,复用同一实例与 eventDispatcher)。
   * SDK 的 close() 会 removeAllListeners,不会触发自动重连;start() 会清除 terminalError。
   */
  private async restartClient(reason: string): Promise<void> {
    if (this.restarting || !this.client || !this.eventDispatcher) return
    this.restarting = true
    try {
      log('info', 'feishu-bot', `restarting ws client (${reason})`)
      try {
        this.client.close({ force: true })
      } catch {
        /* ignore */
      }
      await this.client.start({ eventDispatcher: this.eventDispatcher })
    } catch (err) {
      log(
        'warn',
        'feishu-bot',
        `restart failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      this.restarting = false
    }
  }

  /**
   * 轮询 SDK 内部连接状态(每 3 秒)。
   * - M4: 处理 failed 态 — SDK 重试耗尽后由外层守护重启(指数退避,上限 MAX_GUARD_ATTEMPTS)
   * - 捕获 onReady 之外的边角状态(如后台未配置时持续 connecting)
   * stop() 时清理。
   */
  private statusTimer: ReturnType<typeof setInterval> | null = null
  private connectStartTime = 0
  private startStatusPolling(): void {
    this.stopStatusPolling()
    this.connectStartTime = Date.now()
    this.statusTimer = setInterval(() => {
      if (!this.client) {
        this.stopStatusPolling()
        return
      }
      const conn = this.client.getConnectionStatus()
      // M4 修复: 处理 failed 态 — SDK 已放弃重试(terminalError),由外层守护重启
      if (conn.state === 'failed') {
        if (this.userStopped) {
          this.stopStatusPolling()
          return
        }
        if (this.guardAttempts >= MAX_GUARD_ATTEMPTS) {
          this.setStatus('error', {
            error: '自动重连多次失败,请检查网络/凭证后在设置页手动重连',
          })
          this.stopStatusPolling()
          return
        }
        const now = Date.now()
        if (now >= this.nextGuardRetryAt && !this.restarting) {
          this.guardAttempts++
          // 指数退避: 5s,10s,20s,...,封顶 60s
          this.nextGuardRetryAt = now + Math.min(5000 * 2 ** (this.guardAttempts - 1), 60_000)
          this.setStatus('connecting')
          void this.restartClient('guard')
        }
        return
      }
      if (conn.state === 'connected') {
        // 已连接: 重置守护计数与"假连接"计时窗口 — 否则会话中期的重连会
        // 因 connectStartTime 停留在数小时前而被 60s 规则误判为假连接
        this.guardAttempts = 0
        this.connectStartTime = Date.now()
        return
      }
      // 飞书后台未配置事件订阅时,SDK 会持续重连(state=connecting/reconnecting)。
      // 超过 60 秒仍未连上,提示用户检查后台配置(而非无限显示"连接中")。
      if (
        (conn.state === 'connecting' || conn.state === 'reconnecting') &&
        this.currentStatus !== 'connected' &&
        Date.now() - this.connectStartTime > 60_000
      ) {
        this.setStatus('error', {
          error: '长时间未连上,请检查飞书后台是否已配置长连接事件订阅(im.message.receive_v1)',
        })
        this.stopStatusPolling()
      }
    }, 3000)
  }

  private stopStatusPolling(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
  }

  /** 停止长连接。@param opts.userInitiated 用户手动停止(默认 true);内部重启传 false,不污染 userStopped */
  async stop(opts?: { userInitiated?: boolean }): Promise<void> {
    // M3 修复: 内部重启(start 换 appId)不算用户停止
    if (opts?.userInitiated !== false) {
      this.userStopped = true
    }
    this.stopStatusPolling()
    this.detachResumeListener()
    // 主动关闭 WSClient 的底层 WebSocket 连接(force 模式立即断开),
    // 避免置 null 后后台重连线程继续触发 onReady/onReconnecting 回调。
    if (this.client) {
      try {
        this.client.close({ force: true })
      } catch (err) {
        log('warn', 'feishu-bot', `close error: ${err}`)
      }
    }
    this.client = null
    this.sdkClient = null
    this.connectedAt = undefined
    if (this.currentStatus !== 'idle') {
      this.setStatus('idle')
    }
    log('info', 'feishu-bot', 'stopped (user-initiated)')
  }

  /** 用户是否手动停止了(用于阻止"保存即重连"自动重启) */
  isUserStopped(): boolean {
    return this.userStopped
  }

  /**
   * 处理一条收到的飞书消息。
   * 安全过滤:只响应 P2P 私聊,或群里 @了机器人的消息。
   */
  private async handleMessage(data: FeishuMessageEvent, ctx: CommandContext): Promise<void> {
    const msg = data.message
    if (!msg) return

    // 只处理文本消息(其它类型如图片/文件暂不支持)
    if (msg.message_type !== 'text') return

    // 安全过滤:群聊必须 @机器人;p2p 直接处理
    const chatType = msg.chat_type
    if (chatType !== 'p2p') {
      const mentions = msg.mentions ?? []
      if (mentions.length === 0) return // 群里没 @机器人,忽略
    }

    // 解析消息文本(content 是 JSON 字符串: {"text":"@_user_1 你好"})
    // R6-7 修复:使用 feishu-message-utils.extractText 防止原型链污染
    const text = extractText(msg.content, msg.mentions ?? [])
    if (!text || text.trim().length === 0) return

    this.processingCount++
    const messageId = msg.message_id
    log('info', 'feishu-bot', `recv [${chatType}] "${text.slice(0, 50)}"`)

    try {
      // 先尝试斜杠命令;非命令转 Agent 对话
      let reply: string | null
      try {
        reply = await this.router.dispatch(text, ctx)
      } catch (err) {
        reply = `命令处理出错: ${err instanceof Error ? err.message : String(err)}`
      }

      if (reply === null) {
        // 普通对话 → 默认 Agent
        reply = await ctx.runAgent(text)
      }

      if (reply && messageId) {
        await this.reply(messageId, reply)
      }
    } finally {
      this.processingCount--
    }
  }

  /**
   * 运行默认 Agent 并收集完整回复文本。
   * runAgent 直接返回本次执行的 AgentExecution(不再从 executionHistory 猜最后一条,
   * 避免排队/并发时取到别的运行结果)。
   */
  private async runAgentAndCollect(prompt: string, win: BrowserWindow | null): Promise<string> {
    // 选用默认 main agent;若不存在则用第一个 enabled 的 agent
    const agents = agentService.listAgents().filter((a) => a.enabled)
    const target = agents.find((a) => a.id === DEFAULT_AGENT_ID) ?? agents[0]
    if (!target) {
      return '当前没有可用的 Agent,请先在 Agent 管理中启用一个。'
    }

    try {
      // win 可能为 null(无窗口场景);runAgent 内部 sendStatus 对 null/已销毁窗口是安全的
      const execution = await agentService.runAgent(target.id, prompt, win as BrowserWindow)
      if (!execution) return '(执行已被中止)'
      if (execution.status !== 'success') {
        return `Agent 执行出错: ${execution.output || '未知错误'}`
      }
      return execution.output || '(Agent 返回空内容)'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'feishu-bot', `agent run failed for ${target.id}: ${msg}`)
      // runAgent 抛错时(如 agent disabled/排队已满)也尝试从 history 取错误输出
      const history = agentService.getHistory(target.id)
      const last = history[history.length - 1]
      if (last?.output) return `执行失败: ${last.output}`
      return `执行失败: ${msg}`
    }
  }

  /** 按消息 ID 回复(用户在飞书看到的是对话流式回复) */
  private async reply(messageId: string, text: string): Promise<void> {
    if (!this.sdkClient) {
      log('warn', 'feishu-bot', 'sdkClient missing, cannot reply')
      return
    }
    const truncated =
      text.length > REPLY_CHAR_LIMIT ? `${text.slice(0, REPLY_CHAR_LIMIT)}\n…(已截断)` : text
    try {
      // H2 修复: 检查飞书业务返回码 — 缺权限/限流/消息过期等失败会 resolve(code!==0)
      // 而非 throw,此前一律记为"reply sent",失败被静默吞掉
      const res = (await this.sdkClient.im.message.reply({
        data: {
          content: JSON.stringify({ text: truncated }),
          msg_type: 'text',
        },
        path: { message_id: messageId },
      })) as { code?: number; msg?: string }
      if (res && typeof res.code === 'number' && res.code !== 0) {
        log(
          'error',
          'feishu-bot',
          `reply rejected by feishu: code=${res.code} msg=${res.msg ?? ''}`,
        )
        return
      }
      log('info', 'feishu-bot', `reply sent (${truncated.length} chars)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'feishu-bot', `reply failed: ${msg}`)
    }
  }

  /** 更新状态并广播(供设置页徽章订阅) */
  private setStatus(status: BotStatus, extra?: { error?: string; connectedAt?: number }): void {
    this.currentStatus = status
    if (extra?.error !== undefined) this.lastError = extra.error
    if (status === 'connected') this.lastError = undefined
    if (extra?.connectedAt !== undefined) this.connectedAt = extra.connectedAt
    if (status === 'idle' || status === 'error') this.connectedAt = undefined
    this.emit('status', this.getStatus())
  }
}

/** 飞书机器人服务单例 */
export const feishuBotService = new FeishuBotService()

// 重新导出错误信息工具,避免本模块外部调用方再 import eaa-bridge
export { getErrorMessage }
