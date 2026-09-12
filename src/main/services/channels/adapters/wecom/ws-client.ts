// =============================================================
// adapters/wecom/ws-client — 企微智能机器人长连接客户端(自研)
// 帧协议(官方 SDK @wecom/aibot-node-sdk 逐字段核对):
//   上行 {cmd, headers: {req_id}, body};req_id = `<cmd前缀>_<ts>_<rand>`
//   认证  {cmd:'aibot_subscribe', body:{bot_id, secret}} → {errcode:0}
//   心跳  {cmd:'ping'} → errcode 0;连续 2 次未确认判死线
//   回复  {cmd:'aibot_respond_msg', headers:{req_id: 回调帧同值},
//          body:{msgtype:'stream', stream:{id, finish, content}}}
//   推送  {cmd:'aibot_send_msg', body:{chatid, msgtype:'text', text:{content}}}
//   下行  {cmd:'aibot_msg_callback'|'aibot_event_callback', body:{...}}
// disconnected_event(新连接踢旧连接)→ 不重连(重连也会被再次断开)。
// ws 工厂可注入(vitest 假连接锚定协议行为)。
// =============================================================

import { EventEmitter } from 'node:events'
import { errText } from '../../../../utils/err-text'
import { log } from '../../../../utils/logger'
import {
  AUTH_TIMEOUT_MS,
  GUARD_BACKOFF_BASE_MS,
  GUARD_BACKOFF_MAX_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_AUTH_FAILURE_ATTEMPTS,
  MAX_GUARD_ATTEMPTS,
  MAX_MISSED_PONG,
  WECOM_CMD,
  WECOM_WS_URL,
} from './constants'
import type { WsFactory, WsLike } from '../dingtalk/stream-client'

/** 上/下行帧通用形状 */
export interface WecomFrame {
  cmd?: string
  headers?: { req_id?: string }
  body?: Record<string, unknown>
  errcode?: number
  errmsg?: string
}

export type WecomClientStatus = 'connecting' | 'connected' | 'error'

export interface WecomWsOptions {
  botId: string
  secret: string
  /** 消息回调(aibot_msg_callback / aibot_event_callback) */
  onMessage: (frame: WecomFrame) => void
  wsFactory?: WsFactory
  wsUrl?: string
}

export class WecomWsClient extends EventEmitter {
  private ws: WsLike | null = null
  private stopped = false
  private gaveUp = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private missedPong = 0
  private guardAttempts = 0
  private authFailures = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnecting = false
  private readonly opts: WecomWsOptions

  constructor(opts: WecomWsOptions) {
    super()
    this.setMaxListeners(20)
    this.opts = opts
  }

  async connect(): Promise<void> {
    if (this.ws) return
    this.stopped = false
    this.gaveUp = false
    this.emit('status', 'connecting' as WecomClientStatus)
    await this.openOnce()
  }

  /** 主动立即重连(powerMonitor 唤醒等场景;认证态保留) */
  forceReconnect(reason: string): void {
    if (this.stopped || this.reconnecting) return
    log('info', 'wecom', `ws force reconnect (${reason})`)
    this.teardown()
    void this.scheduleReconnect(0)
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.ws) {
      try {
        this.ws.removeAllListeners('open')
        this.ws.removeAllListeners('message')
        this.ws.removeAllListeners('close')
        this.ws.removeAllListeners('error')
        this.ws.close(1000, 'client-stop')
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  /**
   * 发送回复帧(respond_msg/send_msg;req_id 决定被动回复还是主动推送)。
   * 回执 best-effort:errcode != 0 记日志(不阻塞流式节奏)。
   */
  sendCommand(cmd: string, reqId: string, body: Record<string, unknown>): void {
    this.sendJson({ cmd, headers: { req_id: reqId }, body })
  }

  // ===========================================================
  // 内部
  // ===========================================================

  private async openOnce(): Promise<void> {
    if (this.ws || this.stopped) return
    const ws = this.createSocket(this.opts.wsUrl ?? WECOM_WS_URL)
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        cleanup()
        resolve()
      }
      const onClose = (code: number): void => {
        cleanup()
        reject(new Error(`企微长连接握手断开(close=${code})`))
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
    ws.on('message', (buf: Buffer) => this.handleFrame(buf))
    ws.on('close', () => this.handleClose('ws close'))
    ws.on('error', (err: Error) => {
      log('warn', 'wecom', `ws error: ${err.message}`)
    })

    // 订阅认证: 等待 errcode 响应(超时视为网络故障)
    const authReqId = this.reqId(WECOM_CMD.SUBSCRIBE)
    const authResult = await this.waitAuthResult(authReqId)
    this.ws = null
    if (!authResult.ok) {
      try {
        ws.removeAllListeners()
        ws.close(1000, 'auth-failed')
      } catch {
        /* ignore */
      }
      throw new Error(authResult.message)
    }
    this.ws = ws
    this.guardAttempts = 0
    this.missedPong = 0
    this.startHeartbeat()
    this.emit('status', 'connected' as WecomClientStatus)
  }

  /** 发送订阅帧并等认证结果 */
  private waitAuthResult(
    reqId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    return new Promise((resolve) => {
      let settled = false
      const ws = this.ws
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.off('auth-result', onResult)
        resolve({ ok: false, message: `企微订阅超时(${AUTH_TIMEOUT_MS / 1000}s 无响应)` })
      }, AUTH_TIMEOUT_MS)
      const onResult = (errcode?: number, errmsg?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.off('auth-result', onResult)
        if (errcode === 0) resolve({ ok: true })
        else {
          this.authFailures++
          resolve({
            ok: false,
            message: `企微认证失败(errcode=${errcode}${errmsg ? ` ${errmsg}` : ''});请检查 Bot ID 与长连接 Secret`,
          })
        }
      }
      this.on('auth-result', onResult)
      ws?.send(
        JSON.stringify({
          cmd: WECOM_CMD.SUBSCRIBE,
          headers: { req_id: reqId },
          body: { bot_id: this.opts.botId, secret: this.opts.secret },
        }),
      )
      void ws
    })
  }

  private handleFrame(buf: Buffer): void {
    let frame: WecomFrame
    try {
      frame = JSON.parse(buf.toString('utf8')) as WecomFrame
    } catch (err) {
      log('warn', 'wecom', `frame parse failed: ${errText(err)}`)
      return
    }
    // 有 cmd 的帧 = 平台推送(消息/事件)
    if (frame.cmd === WECOM_CMD.CALLBACK || frame.cmd === WECOM_CMD.EVENT_CALLBACK) {
      // disconnected_event: 新连接接管,服务端将断开本连接 — 不重连
      const eventType = (
        frame.body?.event as { eventtype?: string } | undefined
      )?.eventtype
      if (eventType === 'disconnected_event') {
        log('warn', 'wecom', 'disconnected_event: 被新连接接管,本连接停止(不重连)')
        this.stopped = true
        this.clearTimers()
        try {
          this.ws?.removeAllListeners()
          this.ws?.close(1000, 'takeover')
        } catch {
          /* ignore */
        }
        this.ws = null
        this.emit('status', 'error' as WecomClientStatus, '连接被新的连接接管(企微每机器人仅允许一条长连接)')
        return
      }
      try {
        this.opts.onMessage(frame)
      } catch (err) {
        log('error', 'wecom', `message handler threw: ${errText(err)}`)
      }
      return
    }
    // 无 cmd: 认证/心跳响应或回执 — 认证响应经内部事件转发
    if (frame.headers?.req_id?.startsWith(WECOM_CMD.SUBSCRIBE)) {
      this.emit('auth-result', frame.errcode, frame.errmsg)
      return
    }
    if (frame.headers?.req_id?.startsWith(WECOM_CMD.HEARTBEAT)) {
      if (frame.errcode === 0) this.missedPong = 0
      return
    }
    // 回复回执(respond/send):errcode != 0 记日志
    if (typeof frame.errcode === 'number' && frame.errcode !== 0) {
      log('warn', 'wecom', `reply ack error: ${frame.errcode} ${frame.errmsg ?? ''}`)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.missedPong >= MAX_MISSED_PONG) {
        log('warn', 'wecom', `连续 ${this.missedPong} 次心跳未确认,判死线重连`)
        this.teardown()
        void this.scheduleReconnect()
        return
      }
      this.missedPong++
      this.sendJson({ cmd: WECOM_CMD.HEARTBEAT, headers: { req_id: this.reqId(WECOM_CMD.HEARTBEAT) } })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private handleClose(reason: string): void {
    if (this.stopped) return
    log('info', 'wecom', `ws closed (${reason})`)
    this.teardown()
    void this.scheduleReconnect()
  }

  private teardown(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
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

  private async scheduleReconnect(delayOverride?: number): Promise<void> {
    if (this.stopped || this.gaveUp || this.reconnecting || this.ws) return
    this.reconnecting = true
    try {
      if (this.authFailures >= MAX_AUTH_FAILURE_ATTEMPTS) {
        this.gaveUp = true
        this.emit(
          'status',
          'error' as WecomClientStatus,
          '企微认证连续失败,请检查 Bot ID / Secret 后重新连接',
        )
        return
      }
      if (this.guardAttempts >= MAX_GUARD_ATTEMPTS) {
        this.gaveUp = true
        this.guardAttempts = 0
        this.emit('status', 'error' as WecomClientStatus, '自动重连多次失败,请检查网络后重新连接')
        return
      }
      const delay =
        delayOverride ?? Math.min(GUARD_BACKOFF_BASE_MS * 2 ** this.guardAttempts, GUARD_BACKOFF_MAX_MS)
      this.guardAttempts++
      this.emit('status', 'connecting' as WecomClientStatus)
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay)
      })
      if (this.stopped) return
      await this.openOnce()
    } catch (err) {
      log('warn', 'wecom', `reconnect failed: ${errText(err)}`)
    } finally {
      this.reconnecting = false
    }
    if (!this.ws && !this.stopped && !this.gaveUp) {
      void this.scheduleReconnect()
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private reqId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  private sendJson(payload: Record<string, unknown>): void {
    try {
      this.ws?.send(JSON.stringify(payload))
    } catch (err) {
      log('warn', 'wecom', `send failed: ${errText(err)}`)
    }
  }

  private createSocket(url: string): WsLike {
    if (this.opts.wsFactory) return this.opts.wsFactory(url)
    // biome-ignore lint/correctness/noNodejsModules: 主进程服务按需加载原生 ws
    const WS = require('ws') as unknown as new (url: string) => WsLike
    return new WS(url)
  }
}
