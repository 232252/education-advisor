// =============================================================
// adapters/qq/gateway — QQ Bot WebSocket Gateway 薄客户端
// RESUME + 指数退避重连 + session_id/last_seq 保持
// =============================================================

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import {
  QQ_DEFAULT_API_BASE,
  QQ_INTENT_DIRECT_MESSAGE,
  QQ_INTENT_GROUP_AND_C2C,
  QQ_INTENT_PUBLIC_GUILD_MESSAGES,
  QQ_OP_DISPATCH,
  QQ_OP_HEARTBEAT,
  QQ_OP_HELLO,
  QQ_OP_IDENTIFY,
  QQ_OP_INVALID_SESSION,
  QQ_OP_RECONNECT,
  QQ_OP_RESUME,
  QQ_RECONNECT_DELAYS_MS,
} from './constants'
import { fetchQqAccessToken, fetchQqGatewayUrl, type FetchLike } from './token'

/** WebSocket 最小接口(与钉钉 WsLike 同构;测试可注入假实现) */
export interface WsLike {
  on(event: 'open', fn: () => void): this
  on(event: 'close', fn: (code: number, reason: Buffer) => void): this
  on(event: 'error', fn: (err: Error) => void): this
  on(event: 'message', fn: (data: Buffer | string) => void): this
  off?(event: string, fn: (...args: never[]) => void): this
  removeAllListeners?(event?: string): this
  send(data: string): void
  close(code?: number, reason?: string): void
  readyState: number
}

export type WsFactory = (url: string) => WsLike

const WS_OPEN = 1

export interface QqGatewayOptions {
  appId: string
  clientSecret: string
  apiBase?: string
  fetchImpl?: FetchLike
  wsFactory?: WsFactory
  onDispatch: (eventType: string, data: unknown) => void
}

export class QqGatewayClient extends EventEmitter {
  private ws: WsLike | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastSeq: number | null = null
  private sessionId: string | null = null
  private stopped = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private accessToken = ''

  constructor(private readonly opts: QqGatewayOptions) {
    super()
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.emit('status', 'connecting')
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const tokenCache = await fetchQqAccessToken(
      this.opts.appId,
      this.opts.clientSecret,
      fetchImpl,
    )
    this.accessToken = tokenCache.accessToken
    const url = await fetchQqGatewayUrl(
      tokenCache.accessToken,
      this.opts.apiBase || QQ_DEFAULT_API_BASE,
      fetchImpl,
    )
    const factory =
      this.opts.wsFactory ?? ((u: string) => new WebSocket(u) as unknown as WsLike)
    const ws = factory(url)
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        if (typeof ws.off === 'function') {
          ws.off('open', onOpen as (...args: never[]) => void)
          ws.off('error', onError as (...args: never[]) => void)
        } else {
          ws.removeAllListeners?.('open')
          ws.removeAllListeners?.('error')
        }
      }
      ws.on('open', onOpen)
      ws.on('error', onError)
    })

    ws.on('message', (raw) => this.onMessage(raw))
    ws.on('close', () => {
      this.clearHeartbeat()
      if (!this.stopped) {
        this.emit('status', 'connecting')
        this.scheduleReconnect()
      }
    })
    ws.on('error', (err) => {
      this.emit('status', 'error', err.message)
    })
  }

  private onMessage(raw: Buffer | string): void {
    let payload: { op?: number; s?: number | null; t?: string; d?: unknown }
    try {
      payload = JSON.parse(String(raw))
    } catch {
      return
    }
    if (typeof payload.s === 'number') this.lastSeq = payload.s
    const op = payload.op
    if (op === QQ_OP_HELLO) {
      const d = (payload.d as { heartbeat_interval?: number }) || {}
      const interval = Number(d.heartbeat_interval ?? 41250)
      this.startHeartbeat(interval)
      if (this.sessionId && this.lastSeq != null) {
        this.sendResume()
      } else {
        this.sendIdentify()
      }
      return
    }
    if (op === QQ_OP_DISPATCH) {
      const t = String(payload.t ?? '')
      if (t === 'READY') {
        const d = (payload.d as { session_id?: string }) || {}
        if (d.session_id) this.sessionId = String(d.session_id)
        this.reconnectAttempt = 0
        this.emit('status', 'connected')
      } else if (t === 'RESUMED') {
        this.reconnectAttempt = 0
        this.emit('status', 'connected')
      }
      if (t) this.opts.onDispatch(t, payload.d)
      return
    }
    if (op === QQ_OP_RECONNECT) {
      this.ws?.close()
      return
    }
    if (op === QQ_OP_INVALID_SESSION) {
      const canResume = Boolean(payload.d)
      if (!canResume) {
        this.sessionId = null
        this.lastSeq = null
      }
      this.ws?.close()
    }
  }

  private sendIdentify(): void {
    const intents =
      QQ_INTENT_GROUP_AND_C2C | QQ_INTENT_PUBLIC_GUILD_MESSAGES | QQ_INTENT_DIRECT_MESSAGE
    this.send({
      op: QQ_OP_IDENTIFY,
      d: {
        token: `QQBot ${this.accessToken}`,
        intents,
        shard: [0, 1],
      },
    })
  }

  private sendResume(): void {
    this.send({
      op: QQ_OP_RESUME,
      d: {
        token: `QQBot ${this.accessToken}`,
        session_id: this.sessionId,
        seq: this.lastSeq,
      },
    })
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: QQ_OP_HEARTBEAT, d: this.lastSeq })
    }, intervalMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.reconnectTimer) return
    const delay =
      QQ_RECONNECT_DELAYS_MS[
        Math.min(this.reconnectAttempt, QQ_RECONNECT_DELAYS_MS.length - 1)
      ] ?? 30_000
    this.reconnectAttempt++
    this.emit('reconnect', this.reconnectAttempt, delay)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      void this.connect().catch((err) => {
        this.emit('status', 'error', err instanceof Error ? err.message : String(err))
        this.scheduleReconnect()
      })
    }, delay)
  }

  stop(): void {
    this.stopped = true
    this.clearHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
  }

  forceReconnect(reason?: string): void {
    void reason
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }
}
