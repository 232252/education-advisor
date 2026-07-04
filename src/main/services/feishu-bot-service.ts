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
import type { BrowserWindow } from 'electron'
import { log } from '../utils/logger'
import { agentService } from './agent-service'
import { eaaBridge, getErrorMessage } from './eaa-bridge'
import {
  type CommandContext,
  createDefaultRouter,
  type FeishuCommandRouter,
} from './feishu-command-router'

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
}

const DEFAULT_AGENT_ID = 'main'
/** 飞书单条文本消息内容上限(字符),超出截断 */
const REPLY_CHAR_LIMIT = 4000

/**
 * fetch-based HTTP 实例,替代 SDK 默认的 axios。
 *
 * 必要性:axios 1.13.x 在 Node 22+/26 上存在兼容性 bug,部分 HTTPS 请求
 * 会返回 400(尤其是飞书长连接 endpoint /callback/ws/endpoint)。Node 内置的
 * fetch 没有此问题。这里实现 SDK 期望的 HttpInstance 接口(7 个方法),
 * 全部用 fetch 绕过 axios。
 */
const FEISHU_BASE = 'https://open.feishu.cn'

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
    url = `${FEISHU_BASE}${url}`
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
  /** 用户手动停止标志:阻止"保存即重连"自动重启 */
  private userStopped = false

  constructor() {
    super()
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
    }
  }

  /**
   * 启动飞书长连接机器人。
   * @param appId     飞书应用 App ID
   * @param appSecret 飞书应用 App Secret(从 keystore 读取,不在此持久化)
   * @param win       主窗口(用于 agentService.runAgent 的状态推送)
   */
  async start(appId: string, appSecret: string, win: BrowserWindow | null): Promise<void> {
    // 用户手动启动,清除停止标志
    this.userStopped = false
    // 已在运行且 appId 相同 → 跳过
    if (this.client && this.currentAppId === appId && this.currentStatus === 'connected') {
      log('info', 'feishu-bot', `already connected with appId=${appId}, skip`)
      return
    }
    // 先停掉旧连接(appId 可能变了)
    if (this.client) {
      await this.stop()
    }

    if (!appId || !appSecret) {
      this.setStatus('idle', { error: 'appId 或 appSecret 为空' })
      return
    }

    this.currentAppId = appId
    this.setStatus('connecting')

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
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        try {
          await this.handleMessage(data, ctx)
        } catch (err) {
          log('error', 'feishu-bot', `message handler error: ${err}`)
        }
      },
    })

    // SDK Client:用于按 message_id 回复消息
    // httpInstance 用 fetch 实现,绕过 axios 在高版本 Node 上的 400 bug
    this.sdkClient = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      httpInstance: fetchHttpInstance,
    })

    // 长连接客户端(eventDispatcher 在 start() 时传入,不在构造时)
    // 通过回调跟踪 SDK 内部连接状态,正确反映 connecting/connected/重连
    // httpInstance 用 fetch 实现(同上,绕过 axios 400 bug)
    this.client = new lark.WSClient({
      appId,
      appSecret,
      domain: lark.Domain.Feishu,
      httpInstance: fetchHttpInstance,
      loggerLevel: lark.LoggerLevel.warn,
      autoReconnect: true,
      onReady: () => {
        // 首次 WebSocket 握手成功
        this.connectedAt = Date.now()
        this.lastError = undefined
        this.setStatus('connected')
        log('info', 'feishu-bot', `connected, appId=${appId}`)
      },
      onError: (err: Error) => {
        // 重试耗尽或致命错误
        this.setStatus('error', { error: err.message })
        log('error', 'feishu-bot', `connection error: ${err.message}`)
      },
      onReconnecting: () => {
        this.setStatus('connecting')
        log('info', 'feishu-bot', 'reconnecting...')
      },
      onReconnected: () => {
        this.connectedAt = Date.now()
        this.setStatus('connected')
        log('info', 'feishu-bot', 'reconnected')
      },
    })

    try {
      // start() 在首次握手后 resolve,但实际连接状态由回调驱动。
      // 若 start 本身抛错(如 appId 非法),标记 error。
      await this.client.start({ eventDispatcher })
      // resolve 后若状态仍是 connecting(后台未配置事件订阅时会持续重连),
      // 启动一个轮询,在真正连上或长时间失败后更新可见状态。
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
   * 轮询 SDK 内部连接状态(每 3 秒)。
   * 用于捕获 onReady 之外的边角状态(如后台未配置时持续 connecting)。
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

  /** 停止长连接 */
  async stop(): Promise<void> {
    this.userStopped = true
    this.stopStatusPolling()
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
    const text = this.extractText(msg.content, msg.mentions ?? [])
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
   * 从飞书消息 content 中提取纯文本,并去掉 @机器人 的占位符。
   * @param content   JSON 字符串,如 {"text":"@_user_1 你好"}
   * @param mentions  @信息数组,key 是占位符(如 @_user_1)
   */
  private extractText(content: string, mentions: Array<{ key: string; name: string }>): string {
    let raw: string
    try {
      const parsed = JSON.parse(content) as { text?: string }
      raw = parsed.text ?? ''
    } catch {
      // content 不是合法 JSON,直接用原始字符串
      raw = content
    }
    if (!raw) return ''
    // 去掉 @机器人 占位符(@_user_1 等),保留其余文本
    let cleaned = raw
    for (const m of mentions) {
      if (m.key) {
        cleaned = cleaned.split(m.key).join('')
      }
    }
    return cleaned.trim()
  }

  /**
   * 运行默认 Agent 并收集完整回复文本。
   * runAgent 返回 void,完成后从 executionHistory 取最后一条 output。
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
      await agentService.runAgent(target.id, prompt, win as BrowserWindow)
      const history = agentService.getHistory(target.id)
      const last = history[history.length - 1]
      if (!last) return '(Agent 未产生输出)'
      if (last.status === 'error') return `Agent 执行出错: ${last.output || '未知错误'}`
      return last.output || '(Agent 返回空内容)'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'feishu-bot', `agent run failed for ${target.id}: ${msg}`)
      // runAgent 抛错时(如 agent disabled/running)也尝试从 history 取错误输出
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
      await this.sdkClient.im.message.reply({
        data: {
          content: JSON.stringify({ text: truncated }),
          msg_type: 'text',
        },
        path: { message_id: messageId },
      })
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
