// =============================================================
// adapters/feishu/connection — 飞书长连接机器人(连接层/编排)
// (M3 从 feishu-bot-service.ts 整体搬入;阶段 2 兼容壳 feishu-bot/* 已删除)
//
// 使用 @larksuiteoapi/node-sdk 的 WSClient(长连接模式)接收飞书消息,
// 无需公网地址/内网穿透。收到消息后:
//   - / 开头 → 斜杠命令路由(runtime/command)
//   - 否则   → 默认 Agent(main)对话,完成后把回复发回飞书
//
// 状态通过 EventEmitter 推送('status' 事件),供设置页徽章/ChannelManager 订阅。
// 密钥从不持久化在本模块,每次 start 由调用方从 keystore 读取传入。
//
// 模块归属(阶段 1 频道化):
//   通用件在 channels/runtime(队列/去重/最近文件/命令/附件落盘)与
//   channels/bridge(Agent 调度/批处理编排);本目录(adapters/feishu)
//   只保留飞书平台件:连接生命周期/解析/回复/流式卡片/下载。
// =============================================================

import { EventEmitter } from 'node:events'
import path from 'node:path'
import * as lark from '@larksuiteoapi/node-sdk'
<<<<<<< HEAD:src/main/services/channels/adapters/feishu/connection.ts
import type { ReplySession } from '@shared/types'
import { app, type BrowserWindow, powerMonitor } from 'electron'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import { getTenantToken } from '../../../feishu/token'
import type { FeishuDomain } from '../../../feishu-service'
import { settingsService } from '../../../settings-service'
import { createCommandContext } from '../../bridge/command-context'
import { ChatMessageQueue } from '../../runtime/chat-queue'
import { type CommandRouter, createDefaultRouter } from '../../runtime/command/router'
import { MessageDedupCache } from '../../runtime/dedup-cache'
import { RecentFilesStore } from '../../runtime/recent-files'
import { APP_ID_PATTERN, MAX_GUARD_ATTEMPTS, RECEIVED_FILES_DIR_NAME } from './constants'
import { validateCredentials } from './credentials'
import { createMessageReceiveHandler } from './event-handler'
import { fetchHttpInstance, setFeishuBase } from './http-instance'
import { createBatchPipeline, type MessageHandlerDeps } from './message-handler'
import type { BotStatus, BotStatusInfo } from './types'
=======
import { type BrowserWindow, powerMonitor } from 'electron'
import { errText } from '../utils/err-text'
import { log } from '../utils/logger'
import { createCommandContext } from './feishu-bot/command-context'
import {
  type CommandContext,
  createDefaultRouter,
  type FeishuCommandRouter,
} from './feishu-bot/command-router'
import { APP_ID_PATTERN, MAX_GUARD_ATTEMPTS } from './feishu-bot/constants'
import { validateCredentials } from './feishu-bot/credentials'
import { MessageDedupCache } from './feishu-bot/dedup-cache'
import { createMessageReceiveHandler } from './feishu-bot/event-handler'
import { fetchHttpInstance, setFeishuBase } from './feishu-bot/http-instance'
import { handleIncomingMessage } from './feishu-bot/message-handler'
import { SerialMessageQueue } from './feishu-bot/message-queue'
import type { BotStatus, BotStatusInfo, FeishuMessageEvent } from './feishu-bot/types'
import type { FeishuDomain } from './feishu-service'
>>>>>>> gitee/main:src/main/services/feishu-bot-service.ts

export type { BotStatus, BotStatusInfo } from './types'

/**
 * 飞书机器人服务(单例)。
 * 通过 start/stop 控制长连接生命周期,状态变化 emit 'status' 事件。
 */
class FeishuBotService extends EventEmitter {
  private client: lark.WSClient | null = null
  private sdkClient: lark.Client | null = null
  private router: CommandRouter
  private currentStatus: BotStatus = 'idle'
  private currentAppId?: string
  private lastError?: string
  private connectedAt?: number
  /** 运行中的消息处理计数,用于诊断并发 */
  private processingCount = 0
  /** H3: 已处理 message_id 去重缓存(飞书至少一次投递,重投 id 相同) */
  private dedup = new MessageDedupCache()
  /**
   * 阶段 0: 按会话串行的消息批队列(合并窗口内连发消息合批、会话间并行)
   * + 活动占位会话注册表(stop 时收尾)。每次 start 重建,连接间状态干净。
   */
  private pipeline: { queue: ChatMessageQueue; activeSessions: Set<ReplySession> } | null = null
  /** 当前连接的凭证(内存持有,仅用于流式卡片/文件下载的 token 获取) */
  private creds: { appId: string; appSecret: string; domain: FeishuDomain } | null = null
  /** 每会话"最近发来的文件"记忆(跨重连保留,注入 Agent 上下文) */
  private readonly recentFiles = new RecentFilesStore()
  /** 接收文件保存目录(启动时确定) */
  private filesDir = ''
  /** 用户手动停止标志:阻止"保存即重连"自动重启与守护重启 */
  private userStopped = false
  /** M1/M4: 守护重启状态 — eventDispatcher 留存用于重连,attempts/退避控制 */
  private eventDispatcher: lark.EventDispatcher | null = null
  private guardAttempts = 0
  private nextGuardRetryAt = 0
  private restarting = false
  private statusTimer: ReturnType<typeof setInterval> | null = null
  private connectStartTime = 0

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
      pendingCount: this.pipeline?.queue.pendingCount ?? 0,
    }
  }

  /** M3: 当前 SDK Client(适配器经此发消息/建卡片;stop 后为 null) */
  getSdkClient(): lark.Client | null {
    return this.sdkClient
  }

  /** M3: 接收文件目录(适配器 fetchAttachment 落盘用) */
  getFilesDir(): string {
    return this.filesDir
  }

  /** M3: tenant_access_token(适配器直连 CardKit/下载用;无凭证返回 null) */
  async getAccessToken(): Promise<string | null> {
    if (!this.creds) return null
    try {
      const { token } = await getTenantToken(
        this.creds.appId,
        this.creds.appSecret,
        this.creds.domain,
      )
      return token
    } catch {
      return null
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
    // 凭据去首尾空白: 粘贴带入的空格/换行会让飞书返回 10003/10014 鉴权失败
    appId = appId.trim()
    appSecret = appSecret.trim()
    // 根据域名版本设置 base(单例:fetchRequest / validateCredentials 读取该模块级变量)
    setFeishuBase(domain)
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
    const credError = await validateCredentials(appId, appSecret)
    if (credError) {
      this.setStatus('error', { error: credError })
      log('error', 'feishu-bot', `credential validation failed: ${credError}`)
      return
    }
    this.guardAttempts = 0
    this.nextGuardRetryAt = 0

    // 凭证留存(仅内存):流式卡片/文件下载直连 API 需要 tenant_access_token
    this.creds = { appId, appSecret, domain }

    // 接收文件目录(userData/feishu-files);非 Electron 环境退回临时目录
    try {
      this.filesDir = path.join(app.getPath('userData'), RECEIVED_FILES_DIR_NAME)
    } catch {
      this.filesDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', RECEIVED_FILES_DIR_NAME)
    }

    // 构造命令上下文(注入 EAA + Agent 能力)
    const ctx = createCommandContext(win)

    // M4: 渠道设置(channels.feishu.*)— Agent 绑定与群聊开关
    const channelCfg = settingsService.getSettings().channels?.feishu
    const allowGroups = channelCfg?.allowGroups !== false
    const boundAgentId = typeof channelCfg?.agentId === 'string' ? channelCfg.agentId : undefined

    // 阶段 0 批处理流水线:秒回占位 → 流式卡片 → 终稿;纯文件批回确认
    const activeSessions = new Set<ReplySession>()
    const handlerDeps: MessageHandlerDeps = {
      router: this.router,
      getSdkClient: () => this.sdkClient,
      getAccessToken: () => this.getAccessToken(),
      filesDir: this.filesDir,
      onProcessingStart: () => {
        this.processingCount++
      },
      onProcessingEnd: () => {
        this.processingCount--
      },
      activeSessions,
      recentFiles: this.recentFiles,
      agentId: boundAgentId,
    }
    const pipeline = createBatchPipeline(handlerDeps, ctx, win)
    this.pipeline = { queue: new ChatMessageQueue(pipeline), activeSessions }

    // 事件分发器:注册消息接收事件(register 接收单个 handles 对象)
    // 回调逻辑(去重/排队限流/繁忙回复)见 adapters/feishu/event-handler.ts
    const eventDispatcher = new lark.EventDispatcher({
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      'im.message.receive_v1': createMessageReceiveHandler({
        dedup: this.dedup,
        messageQueue: this.pipeline.queue,
        getSdkClient: () => this.sdkClient,
        allowGroups,
      }),
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
        this.handleConnected(`connected, appId=${appId}`, true)
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
        this.handleConnected('reconnected')
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
      const msg = errText(err)
      this.setStatus('error', { error: msg })
      log('error', 'feishu-bot', `start failed: ${msg}`)
      // 清理半初始化的 client,允许后续重试
      this.client = null
      this.sdkClient = null
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

  /** onReady/onReconnected 共用: 重置守护计数并转 connected(首次连接还清 lastError) */
  private handleConnected(logMsg: string, clearError = false): void {
    this.connectedAt = Date.now()
    if (clearError) this.lastError = undefined
    this.guardAttempts = 0
    this.setStatus('connected')
    log('info', 'feishu-bot', logMsg)
  }

  /** 强制关闭底层 WS(restartClient/stop 共用);SDK close 可能因已断开抛错 */
  private closeClientForce(): void {
    if (!this.client) return
    try {
      this.client.close({ force: true })
    } catch (err) {
      log('warn', 'feishu-bot', `close error: ${errText(err)}`)
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
      this.closeClientForce()
      await this.client.start({ eventDispatcher: this.eventDispatcher })
    } catch (err) {
      log('warn', 'feishu-bot', `restart failed (${reason}): ${errText(err)}`)
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
    // 阶段 0: 先让消息队列排空收尾 — 排队中的消息回"未处理"提示,
    // 运行中的占位卡片立即写入中断说明。此时 sdkClient 仍可用。
    if (this.pipeline) {
      const { queue, activeSessions } = this.pipeline
      this.pipeline = null
      try {
        await queue.cancelAll()
      } catch (err) {
        log('warn', 'feishu-bot', `queue cancel error: ${errText(err)}`)
      }
      for (const session of activeSessions) {
        try {
          await session.fail('机器人已停止,本次回复已中断,请重新发送消息。')
        } catch {
          /* 会话收尾失败不影响停止流程 */
        }
      }
      activeSessions.clear()
    }
    this.creds = null
    // 主动关闭 WSClient 的底层 WebSocket 连接(force 模式立即断开),
    // 避免置 null 后后台重连线程继续触发 onReady/onReconnecting 回调。
    this.closeClientForce()
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

  /** 更新状态并广播(供设置页徽章/ChannelManager 订阅) */
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
