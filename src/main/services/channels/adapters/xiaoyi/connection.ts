// =============================================================
// xiaoyi/connection — single A2A WebSocket link
// =============================================================

import { hostname } from 'node:os'
import { EventEmitter } from 'node:events'
import type { WsLike } from '../dingtalk/stream-client'
import { generateAuthHeaders } from './auth'
import {
  CONNECTION_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
} from './constants'

export interface XiaoyiWsLike extends WsLike {
  readyState?: number
}

export type XiaoyiWsFactory = (
  url: string,
  opts: { headers: Record<string, string>; rejectUnauthorized?: boolean },
) => XiaoyiWsLike

function isIpv4(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) && host.split('.').every((p) => {
    const n = Number(p)
    return n >= 0 && n <= 255
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export interface XiaoyiConnectionOptions {
  serverName: 'primary' | 'backup'
  wsUrl: string
  ak: string
  sk: string
  agentId: string
  onMessage: (message: Record<string, unknown>, serverName: string) => void
  onDisconnect: (serverName: string) => void
  wsFactory?: XiaoyiWsFactory
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

const WS_OPEN = 1

export class XiaoyiConnection extends EventEmitter {
  private ws: XiaoyiWsLike | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  connected = false
  private readonly opts: XiaoyiConnectionOptions
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void

  constructor(opts: XiaoyiConnectionOptions) {
    super()
    this.opts = opts
    this.log = opts.log ?? (() => undefined)
  }

  get serverName(): string {
    return this.opts.serverName
  }

  async connect(): Promise<boolean> {
    await this.cleanup()
    const headers = generateAuthHeaders(this.opts.ak, this.opts.sk, this.opts.agentId)
    const host = hostOf(this.opts.wsUrl)
    const rejectUnauthorized = !isIpv4(host)

    try {
      const ws = this.createSocket(headers, rejectUnauthorized)
      this.ws = ws

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('xiaoyi WS open timeout'))
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

      this.connected = true
      this.log('info', `[${this.opts.serverName}] connected ${this.opts.wsUrl}`)
      this.sendInit()
      this.startHeartbeat()

      ws.on('message', (data: Buffer) => {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
        try {
          const message = JSON.parse(text) as Record<string, unknown>
          this.opts.onMessage(message, this.opts.serverName)
        } catch (err) {
          this.log('error', `[${this.opts.serverName}] JSON parse: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
      ws.on('close', () => {
        this.connected = false
        this.stopHeartbeat()
        this.opts.onDisconnect(this.opts.serverName)
      })
      ws.on('error', (err: Error) => {
        this.log('error', `[${this.opts.serverName}] ${err instanceof Error ? err.message : String(err)}`)
      })
      return true
    } catch (err) {
      this.connected = false
      this.log(
        'error',
        `[${this.opts.serverName}] connect failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      await this.cleanup()
      return false
    }
  }

  private createSocket(headers: Record<string, string>, rejectUnauthorized: boolean): XiaoyiWsLike {
    if (this.opts.wsFactory) {
      return this.opts.wsFactory(this.opts.wsUrl, { headers, rejectUnauthorized })
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WS = require('ws') as unknown as new (
      url: string,
      opts?: { headers?: Record<string, string>; rejectUnauthorized?: boolean; handshakeTimeout?: number },
    ) => XiaoyiWsLike
    return new WS(this.opts.wsUrl, {
      headers,
      rejectUnauthorized,
      handshakeTimeout: CONNECTION_TIMEOUT_MS,
    })
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.stopHeartbeat()
    await this.cleanup()
    this.log('info', `[${this.opts.serverName}] disconnected`)
  }

  sendJson(data: Record<string, unknown>): boolean {
    if (!this.ws || !this.connected) return false
    if (this.ws.readyState != null && this.ws.readyState !== WS_OPEN) return false
    try {
      this.ws.send(JSON.stringify(data))
      return true
    } catch (err) {
      this.log('error', `[${this.opts.serverName}] send: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private sendInit(): void {
    this.sendJson({
      msgType: 'clawd_bot_init',
      agentId: this.opts.agentId,
      msgDetail: JSON.stringify({
        agentId: this.opts.agentId,
        hostname: hostname(),
      }),
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendJson({
        msgType: 'heartbeat',
        agentId: this.opts.agentId,
        msgDetail: JSON.stringify({ timestamp: Date.now() }),
      })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private async cleanup(): Promise<void> {
    this.stopHeartbeat()
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close(1000, 'client-stop')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }
}
