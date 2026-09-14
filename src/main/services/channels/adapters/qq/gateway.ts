// =============================================================
// adapters/qq/gateway — QQ Bot WebSocket Gateway 薄客户端
// 可注入 WsFactory / fetch 便于干跑测试(对齐钉钉 stream-client 的 WsLike)
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
  QQ_OP_RECONNECT,
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
  private stopped = false
  private reconnectAttempt = 0

  constructor(private readonly opts: QqGatewayOptions) {
    super()
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

    ws.on('message', (raw) => this.onMessage(raw, tokenCache.accessToken))
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

  private onMessage(raw: Buffer | string, accessToken: string): void {
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
      this.sendIdentify(accessToken)
      return
    }
    if (op === QQ_OP_DISPATCH) {
      const t = String(payload.t ?? '')
      if (t) this.opts.onDispatch(t, payload.d)
      if (t === 'READY') this.emit('status', 'connected')
      return
    }
    if (op === QQ_OP_RECONNECT) {
      this.ws?.close()
    }
  }

  private sendIdentify(accessToken: string): void {
    const intents =
      QQ_INTENT_GROUP_AND_C2C | QQ_INTENT_PUBLIC_GUILD_MESSAGES | QQ_INTENT_DIRECT_MESSAGE
    this.send({
      op: QQ_OP_IDENTIFY,
      d: {
        token: `QQBot ${accessToken}`,
        intents,
        shard: [0, 1],
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
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5))
    this.reconnectAttempt++
    setTimeout(() => {
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
