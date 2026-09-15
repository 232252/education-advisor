// =============================================================
// yuanbao/ws-client — binary protobuf WS (AuthBind / Ping / Push)
// =============================================================

import { EventEmitter } from 'node:events'
import type { WsFactory, WsLike } from '../dingtalk/stream-client'
import {
  AUTH_ALREADY_CODE,
  AUTH_FAILED_CODES,
  BIZ_CMD_SEND_C2C,
  BIZ_CMD_SEND_GROUP,
  CMD_AUTH_BIND,
  CMD_KICKOUT,
  CMD_PING,
  CMD_TYPE_PUSH,
  CMD_TYPE_RESPONSE,
  CONNECTION_TIMEOUT_MS,
  DEFAULT_WS_URL,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_THRESHOLD,
  MAX_RECONNECT_ATTEMPTS,
  MODULE_BIZ,
  NO_RECONNECT_CLOSE_CODES,
  RECONNECT_DELAYS_MS,
  SEND_TIMEOUT_MS,
} from './constants'
import type { YuanbaoTokenManager } from './auth'
import {
  buildAuthBindMsg,
  buildPingMsg,
  buildPushAck,
  decodeAuthBindRsp,
  decodeConnMsg,
  decodeInboundMessage,
  decodeKickoutMsg,
  decodePingRsp,
  decodeSendRsp,
  type ConnHead,
  type InboundYuanbaoMessage,
} from './codec'

/** Binary-capable WS (ws package send accepts Buffer). */
export type BinaryWsLike = WsLike & {
  send(data: string | Buffer): void
  readyState?: number
}

export type YuanbaoWsFactory = (url: string) => BinaryWsLike

const WS_OPEN = 1

export interface YuanbaoWsOptions {
  tokenManager: YuanbaoTokenManager
  wsUrl?: string
  routeEnv?: string
  onInbound: (msg: InboundYuanbaoMessage, head: ConnHead) => void
  onStatus?: (status: 'connecting' | 'connected' | 'error', detail?: string) => void
  wsFactory?: YuanbaoWsFactory
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export class YuanbaoWsClient extends EventEmitter {
  private ws: BinaryWsLike | null = null
  private stopped = false
  private connected = false
  private botId = ''
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS
  private heartbeatAck = true
  private heartbeatMisses = 0
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private noReconnect = false
  private readonly opts: YuanbaoWsOptions
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void

  constructor(opts: YuanbaoWsOptions) {
    super()
    this.opts = opts
    this.log = opts.log ?? (() => undefined)
  }

  get isConnected(): boolean {
    return this.connected
  }

  get currentBotId(): string {
    return this.botId
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.noReconnect = false
    this.opts.onStatus?.('connecting')
    await this.openOnce()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.teardownWs()
    this.connected = false
  }

  sendRaw(buf: Buffer): boolean {
    if (!this.ws || (this.ws.readyState != null && this.ws.readyState !== WS_OPEN)) {
      if (!this.ws) return false
    }
    if (!this.connected && this.ws.readyState != null && this.ws.readyState !== WS_OPEN) {
      return false
    }
    try {
      this.ws.send(buf)
      return true
    } catch (err) {
      this.log('error', `send failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private createSocket(url: string): BinaryWsLike {
    if (this.opts.wsFactory) return this.opts.wsFactory(url)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WS = require('ws') as unknown as new (url: string) => BinaryWsLike
    return new WS(url)
  }

  private async openOnce(): Promise<void> {
    if (this.stopped) return
    this.teardownWs()
    const tokenData = await this.opts.tokenManager.getToken()
    this.botId = tokenData.botId
    const url = this.opts.wsUrl ?? DEFAULT_WS_URL
    const ws = this.createSocket(url)
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('yuanbao WS open timeout'))
      }, CONNECTION_TIMEOUT_MS)
      const onOpen = (): void => {
        cleanup()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        ws.off('open', onOpen)
        ws.off('error', onError)
      }
      ws.on('open', onOpen)
      ws.on('error', onError)
    })

    this.log('info', `WS connected, AuthBind bot=${this.botId}`)
    const authBinary = buildAuthBindMsg({
      bizId: 'ybBot',
      uid: this.botId,
      source: tokenData.source,
      token: tokenData.token,
      routeEnv: this.opts.routeEnv,
    })
    if (!authBinary) throw new Error('Failed to encode AuthBind')
    ws.send(authBinary)

    const authOk = await this.waitAuth(ws)
    if (!authOk) throw new Error('AuthBind failed')

    this.connected = true
    this.reconnectAttempts = 0
    this.heartbeatAck = true
    this.heartbeatMisses = 0
    this.opts.onStatus?.('connected', `bot_id=${this.botId}`)
    this.log('info', `authenticated bot=${this.botId}`)

    ws.on('message', (data: Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer)
      void this.handleBinary(buf)
    })
    ws.on('close', (code: number, _reason: Buffer) => {
      this.onClose(typeof code === 'number' ? code : 0)
    })
    ws.on('error', (err: Error) => {
      this.log('error', `ws error: ${err instanceof Error ? err.message : String(err)}`)
    })

    this.startHeartbeat()
  }

  private waitAuth(ws: BinaryWsLike): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        cleanup()
        resolve(false)
      }, SEND_TIMEOUT_MS)
      const onMsg = (data: Buffer): void => {
        if (settled) return
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as ArrayBuffer)
        const conn = decodeConnMsg(buf)
        if (!conn || conn.head.cmd !== CMD_AUTH_BIND) return
        cleanup()
        const statusCode = conn.head.status ?? 0
        const rsp = conn.data.length ? decodeAuthBindRsp(conn.data) : {}
        const code = Number((rsp as { code?: number } | null)?.code ?? statusCode)
        if (code === 0 || code === AUTH_ALREADY_CODE) {
          resolve(true)
          return
        }
        if (AUTH_FAILED_CODES.has(code)) {
          void this.opts.tokenManager.forceRefresh().catch(() => undefined)
        }
        this.log('error', `auth failed code=${code}`)
        resolve(false)
      }
      const cleanup = (): void => {
        settled = true
        clearTimeout(timer)
        try {
          ws.removeAllListeners('message')
        } catch {
          /* ignore */
        }
      }
      ws.on('message', onMsg)
    })
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      void this.tickHeartbeat()
    }, this.heartbeatIntervalMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private async tickHeartbeat(): Promise<void> {
    if (!this.connected || !this.ws) return
    if (!this.heartbeatAck) {
      this.heartbeatMisses += 1
      this.log('warn', `heartbeat miss ${this.heartbeatMisses}/${HEARTBEAT_TIMEOUT_THRESHOLD}`)
      if (this.heartbeatMisses >= HEARTBEAT_TIMEOUT_THRESHOLD) {
        this.log('error', 'heartbeat threshold — reconnect')
        this.teardownWs()
        this.scheduleReconnect()
        return
      }
    } else {
      this.heartbeatMisses = 0
    }
    this.heartbeatAck = false
    const ping = buildPingMsg()
    if (ping) this.sendRaw(ping)
  }

  private async handleBinary(raw: Buffer): Promise<void> {
    const conn = decodeConnMsg(raw)
    if (!conn) {
      this.log('warn', 'failed to decode ConnMsg')
      return
    }
    const { head, data } = conn

    if (head.cmdType === CMD_TYPE_PUSH || head.needAck) {
      const ack = buildPushAck(head)
      if (ack) this.sendRaw(ack)
    }

    if (head.cmd === CMD_PING && head.cmdType === CMD_TYPE_RESPONSE) {
      this.heartbeatAck = true
      const rsp = data.length ? decodePingRsp(data) : null
      const interval = Number((rsp as { heartInterval?: number } | null)?.heartInterval ?? 0)
      if (interval > 0) {
        this.heartbeatIntervalMs = interval * 1000
        this.startHeartbeat()
      }
      return
    }

    if (head.cmd === CMD_KICKOUT) {
      const kick = data.length ? decodeKickoutMsg(data) : null
      this.log('error', `kickout ${JSON.stringify(kick)}`)
      this.noReconnect = true
      this.teardownWs()
      this.opts.onStatus?.('error', 'kicked by server')
      return
    }

    if (head.module === MODULE_BIZ && head.cmdType === CMD_TYPE_PUSH) {
      let inbound = decodeInboundMessage(data)
      if (!inbound && data.length) {
        try {
          const asJson = JSON.parse(data.toString('utf8')) as Record<string, unknown>
          if (asJson.fromAccount || asJson.from_account) {
            inbound = {
              callback_command: String(asJson.callbackCommand ?? ''),
              from_account: String(asJson.fromAccount ?? asJson.from_account ?? ''),
              to_account: String(asJson.toAccount ?? asJson.to_account ?? ''),
              sender_nickname: String(asJson.senderNickname ?? ''),
              group_code: String(asJson.groupCode ?? asJson.group_code ?? ''),
              group_name: String(asJson.groupName ?? ''),
              msg_seq: Number(asJson.msgSeq ?? 0),
              msg_time: Number(asJson.msgTime ?? 0),
              msg_key: String(asJson.msgKey ?? ''),
              msg_id: String(asJson.msgId ?? asJson.msg_id ?? ''),
              msg_body: Array.isArray(asJson.msgBody)
                ? (asJson.msgBody as Array<{
                    msg_type: string
                    msg_content: Record<string, unknown>
                  }>)
                : [],
              bot_owner_id: String(asJson.botOwnerId ?? ''),
              claw_msg_type: Number(asJson.clawMsgType ?? 0),
            }
          }
        } catch {
          /* binary only */
        }
      }
      if (inbound) this.opts.onInbound(inbound, head)
      return
    }

    if (
      head.cmdType === CMD_TYPE_RESPONSE &&
      (head.cmd === BIZ_CMD_SEND_C2C || head.cmd === BIZ_CMD_SEND_GROUP)
    ) {
      const rsp = data.length ? decodeSendRsp(data) : null
      this.emit('sendRsp', head.msgId, rsp)
    }
  }

  private onClose(code: number): void {
    this.connected = false
    this.clearHeartbeat()
    this.log('info', `ws closed code=${code}`)
    if (this.stopped) return
    if (NO_RECONNECT_CLOSE_CODES.has(code) || this.noReconnect) {
      this.opts.onStatus?.('error', `non-retryable close ${code}`)
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.noReconnect) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.opts.onStatus?.('error', 'max reconnect attempts')
      return
    }
    const idx = Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)
    const delay = RECONNECT_DELAYS_MS[idx]!
    this.reconnectAttempts += 1
    this.opts.onStatus?.('connecting', `reconnect in ${delay}ms (#${this.reconnectAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openOnce().catch((err) => {
        this.log('error', `reconnect failed: ${err instanceof Error ? err.message : String(err)}`)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private teardownWs(): void {
    this.clearHeartbeat()
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close(1000, 'client-stop')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.connected = false
  }

  private clearTimers(): void {
    this.clearHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}

// silence unused WsFactory import for type docs
export type { WsFactory }
