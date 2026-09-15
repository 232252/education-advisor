// =============================================================
// adapters/dingtalk/stream-client — 钉钉 Stream Mode 自研客户端
// 协议(官方 developerpedia stream/protocol,2026-09-12 核验):
//   1. POST /v1.0/gateway/connections/open {clientId,clientSecret,subscriptions}
//      → {endpoint, ticket}(ticket 90s 有效、一次性)
//   2. WSS 握手 GET {endpoint}?ticket=…
//   3. SYSTEM ping(data 含 opaque) → 回传同 messageId 的 pong,data 原样回 opaque
//   4. SYSTEM disconnect(服务端 ~30s 负载均衡断连) → 主动重连(新 ticket)
//   5. CALLBACK topic → 解析 data 交回调,并立即 ACK {code:200, headers:{messageId 同值}, data:'{"response":null}'}
//
// 自研而不用官方 SDK 的原因: 已知坑(心跳 timer 泄漏/回调超时/8s ping 超时写死)
// + 需要与飞书引擎一致的守护语义(指数退避、powerMonitor 唤醒、状态机)。
// ws 工厂与 fetch 可注入(vitest 假连接锚定协议行为)。
// =============================================================

import { EventEmitter } from 'node:events'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import type { FetchLike } from './api'
import {
  DINGTALK_API_BASE,
  DINGTALK_BOT_TOPIC,
  GUARD_BACKOFF_BASE_MS,
  GUARD_BACKOFF_MAX_MS,
  MAX_GUARD_ATTEMPTS,
  WS_KEEPALIVE_INTERVAL_MS,
} from './constants'

/** 下行帧(Stream 协议信封) */
interface StreamFrame {
  specVersion?: string
  type?: string
  headers?: { topic?: string; contentType?: string; messageId?: string; time?: string }
  data?: string
}

/** WebSocket 最小接口(与 ws 兼容;测试注入假实现) */
export interface WsLike {
  on(event: 'open', fn: () => void): this
  on(event: 'close', fn: (code: number, reason: Buffer) => void): this
  on(event: 'error', fn: (err: Error) => void): this
  on(event: 'message', fn: (data: Buffer) => void): this
  off(event: 'open', fn: () => void): this
  off(event: 'close', fn: (code: number, reason: Buffer) => void): this
  off(event: 'error', fn: (err: Error) => void): this
  removeAllListeners(event?: string): this
  send(data: string): void
  ping(): void
  close(code?: number, reason?: string): void
}

export type WsFactory = (url: string) => WsLike

export interface StreamClientOptions {
  clientId: string
  clientSecret: string
  /** 机器人消息回调(解析后的 data 字符串 + messageId) */
  onMessage: (data: string, messageId: string) => void
  fetchImpl?: FetchLike
  wsFactory?: WsFactory
}

/** 连接层状态(与 BotStatus 五态对齐: connecting/connected/error) */
export type StreamClientStatus = 'connecting' | 'connected' | 'error'

/**
 * Stream Mode 客户端:
 *   - connect(): 建立首连(失败抛错,交引擎记 error)
 *   - 断连自动重连(指数退避 5s→60s,MAX_GUARD_ATTEMPTS 次后置 error)
 *   - ping/pong 心跳(ws 层保活 ping + 协议层 SYSTEM pong)
 *   - stop(): 主动断开并停止重连(userInitiated 语义由调用方管理)
 */
export class DingtalkStreamClient extends EventEmitter {
  private ws: WsLike | null = null
  private stopped = false
  /** 守护重连超限后置 true: 不再自动重连,直到下一次 connect() 手动复位 */
  private gaveUp = false
  private guardAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private reconnecting = false

  private readonly fetchImpl: FetchLike
  private readonly wsFactory: WsFactory | null

  constructor(private readonly opts: StreamClientOptions) {
    super()
    this.setMaxListeners(20)
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
    this.wsFactory = opts.wsFactory ?? null
  }

  /** 建立连接;成功(WS open)后 resolve。已连接时幂等返回。 */
  async connect(): Promise<void> {
    if (this.ws) return
    this.stopped = false
    this.gaveUp = false
    this.emit('status', 'connecting' as StreamClientStatus)
    await this.openOnce()
  }

  /** 停止并清理(不再重连;timer 全清防泄漏) */
  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.ws) {
      try {
        this.ws.close(1000, 'client-stop')
      } catch {
        /* 已断开时忽略 */
      }
      this.ws = null
    }
  }

  /** 主动请求立即重连(powerMonitor 唤醒等场景;连接存活时无操作) */
  forceReconnect(reason: string): void {
    if (this.stopped || this.reconnecting) return
    log('info', 'dingtalk', `stream force reconnect (${reason})`)
    this.teardownSocket()
    void this.scheduleReconnect(0)
  }

  /** 单次建连: 取 ticket → WSS 握手 → 挂事件 */
  private async openOnce(): Promise<void> {
    if (this.ws || this.stopped) return
    const { endpoint, ticket } = await this.openConnection()
    if (this.stopped) return
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`
    const ws = this.createSocket(url)

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        cleanup()
        resolve()
      }
      const onClose = (code: number): void => {
        cleanup()
        reject(new Error(`钉钉 Stream 握手断开(close=${code})`))
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const cleanup = (): void => {
        ws.off('open', onOpen)
        ws.off('close', onClose)
        ws.off('error', onError)
      }
      ws.on('open', onOpen)
      ws.on('close', onClose)
      ws.on('error', onError)
    })

    this.ws = ws
    this.guardAttempts = 0
    this.emit('status', 'connected' as StreamClientStatus)
    this.startKeepalive()
    ws.on('message', (buf: Buffer) => void this.handleFrame(buf))
    ws.on('close', () => this.handleClose('ws close'))
    ws.on('error', (err: Error) => {
      log('warn', 'dingtalk', `stream ws error: ${err.message}`)
    })
  }

  /** connections/open → endpoint + ticket */
  private async openConnection(): Promise<{ endpoint: string; ticket: string }> {
    let resp: Response
    try {
      resp = await this.fetchImpl(`${DINGTALK_API_BASE}/v1.0/gateway/connections/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.opts.clientId,
          clientSecret: this.opts.clientSecret,
          subscriptions: [{ type: 'CALLBACK', topic: DINGTALK_BOT_TOPIC }],
          ua: 'education-advisor/1.0',
        }),
      })
    } catch (err) {
      throw new Error(`钉钉网关不可达: ${errText(err)}`)
    }
    if (!resp.ok) {
      let detail = `${resp.status}`
      try {
        const body = (await resp.json()) as { message?: string; msg?: string }
        detail = String(body.message ?? body.msg ?? detail)
      } catch {
        /* 保持状态码 */
      }
      // 401/400 通常是凭证错误 — 直接抛给上层给出可读提示
      throw new Error(`钉钉 Stream 建连失败(${detail})`)
    }
    const body = (await resp.json()) as { endpoint?: string; ticket?: string }
    if (!body.endpoint || !body.ticket) {
      throw new Error('钉钉网关响应缺 endpoint/ticket')
    }
    return { endpoint: body.endpoint, ticket: body.ticket }
  }

  /** 下行帧分发: SYSTEM ping/disconnect / CALLBACK 机器人消息 */
  private handleFrame(buf: Buffer): void {
    let frame: StreamFrame
    try {
      frame = JSON.parse(buf.toString('utf8')) as StreamFrame
    } catch (err) {
      log('warn', 'dingtalk', `stream frame parse failed: ${errText(err)}`)
      return
    }
    const topic = frame.headers?.topic ?? ''
    const messageId = frame.headers?.messageId ?? ''

    if (frame.type === 'SYSTEM' && topic === 'ping') {
      // 回传 pong: 同 messageId,data 原样回 opaque
      this.sendJson({
        code: 200,
        message: 'OK',
        headers: { contentType: 'application/json', messageId },
        data: frame.data ?? '{}',
      })
      return
    }
    if (frame.type === 'SYSTEM' && topic === 'disconnect') {
      // 服务端负载均衡断连(先推 disconnect,~10s 后断 TCP) → 主动重连抢先恢复
      const reason = (() => {
        try {
          return String((JSON.parse(frame.data ?? '{}') as { reason?: string }).reason ?? '')
        } catch {
          return ''
        }
      })()
      log('info', 'dingtalk', `stream disconnect notice (${reason}), reconnecting`)
      this.teardownSocket()
      void this.scheduleReconnect(0)
      return
    }
    if (frame.type === 'CALLBACK') {
      // 立即 ACK(机器人消息为 fire-and-forget,ACK 仅诊断;仍回执保持协议健康)
      this.sendJson({
        code: 200,
        message: 'OK',
        headers: { contentType: 'application/json', messageId },
        data: '{"response":null}',
      })
      if (frame.data) {
        try {
          this.opts.onMessage(frame.data, messageId)
        } catch (err) {
          log('error', 'dingtalk', `message handler threw: ${errText(err)}`)
        }
      }
    }
  }

  /** ws close → 守护重连(退避),超限置 error */
  private handleClose(reason: string): void {
    if (this.stopped) return
    log('info', 'dingtalk', `stream closed (${reason})`)
    this.teardownSocket()
    void this.scheduleReconnect()
  }

  private async scheduleReconnect(delayOverride?: number): Promise<void> {
    if (this.stopped || this.gaveUp || this.reconnecting || this.ws) return
    this.reconnecting = true
    try {
      if (this.guardAttempts >= MAX_GUARD_ATTEMPTS) {
        this.gaveUp = true
        this.guardAttempts = 0
        this.emit(
          'status',
          'error' as StreamClientStatus,
          '自动重连多次失败,请检查网络/凭证后重新连接',
        )
        return
      }
      const delay =
        delayOverride ??
        Math.min(GUARD_BACKOFF_BASE_MS * 2 ** this.guardAttempts, GUARD_BACKOFF_MAX_MS)
      this.guardAttempts++
      this.emit('status', 'connecting' as StreamClientStatus)
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay)
      })
      if (this.stopped) return
      await this.openOnce()
      log('info', 'dingtalk', `stream reconnected (attempt #${this.guardAttempts})`)
    } catch (err) {
      log('warn', 'dingtalk', `reconnect failed: ${errText(err)}`)
      // 递归继续退避(经 reconnecting=false 释放后重入)
    } finally {
      this.reconnecting = false
    }
    if (!this.ws && !this.stopped) {
      void this.scheduleReconnect()
    }
  }

  /** ws 层保活(25s ping 穿透 NAT;协议层心跳由服务端 SYSTEM ping 驱动) */
  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      try {
        this.ws?.ping()
      } catch {
        /* 已断开时忽略,close 事件驱动重连 */
      }
    }, WS_KEEPALIVE_INTERVAL_MS)
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  private teardownSocket(): void {
    this.stopKeepalive()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        // 按事件名逐个清理: 无参 removeAllListeners() 在子类覆写签名
        // (event?: string) 下会把显式 undefined 传入 super,Node 26 实测
        // 不清空监听器,导致 close 重入死循环
        this.ws.removeAllListeners('open')
        this.ws.removeAllListeners('message')
        this.ws.removeAllListeners('close')
        this.ws.removeAllListeners('error')
        this.ws.close(1000, 'teardown')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  private clearTimers(): void {
    this.stopKeepalive()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private sendJson(payload: Record<string, unknown>): void {
    try {
      this.ws?.send(JSON.stringify(payload))
    } catch (err) {
      log('warn', 'dingtalk', `stream send failed: ${errText(err)}`)
    }
  }

  /** ws 包懒加载(测试注入假工厂时不引真 ws) */
  private createSocket(url: string): WsLike {
    if (this.wsFactory) return this.wsFactory(url)
    // ws 包 CJS 导出即构造函数(module.exports = WebSocket);主进程服务按需加载原生 ws
    const WS = require('ws') as unknown as new (url: string) => WsLike
    return new WS(url)
  }
}
