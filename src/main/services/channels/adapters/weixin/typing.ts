// =============================================================
// adapters/weixin/typing — getconfig typing_ticket + sendTyping 刷新(QwenPaw parity)
// =============================================================

import { log } from '../../../../utils/logger'
import type { ILinkClient } from './ilink-client'

const TICKET_TTL_MS = 24 * 60 * 60 * 1000
const REFRESH_MS = 5_000

type TicketEntry = { ticket: string; fetchedAt: number }

export type TypingStopFn = (sendCancel?: boolean) => void

/**
 * Per-user typing ticket cache + refresh loop.
 * Start on inbound; stop on reply finalize/fail/disconnect.
 */
export class WeixinTypingManager {
  private tickets = new Map<string, TicketEntry>()
  private stops = new Map<string, TypingStopFn>()

  clear(): void {
    for (const [uid, stop] of [...this.stops.entries()]) {
      try {
        stop(false)
      } catch {
        /* ignore */
      }
      this.stops.delete(uid)
    }
    this.tickets.clear()
  }

  stopForUser(userId: string, sendCancel = true): void {
    const stop = this.stops.get(userId)
    if (stop) {
      this.stops.delete(userId)
      try {
        stop(sendCancel)
      } catch {
        /* ignore */
      }
    }
  }

  async start(
    client: ILinkClient,
    userId: string,
    contextToken: string,
  ): Promise<TypingStopFn> {
    this.stopForUser(userId, false)
    const ticket = await this.getTicket(client, userId, contextToken)
    if (!ticket) {
      const noop: TypingStopFn = () => {}
      return noop
    }

    let stopped = false
    let timer: ReturnType<typeof setInterval> | null = null

    const refresh = () => {
      if (stopped) return
      void client.sendTyping(userId, ticket, 1).catch((err) => {
        log('debug', 'weixin', `sendTyping refresh failed: ${String(err)}`)
      })
    }

    refresh()
    timer = setInterval(refresh, REFRESH_MS)

    const stop: TypingStopFn = (sendCancel = true) => {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
      if (sendCancel) {
        void client.sendTyping(userId, ticket, 2).catch(() => {})
      }
    }

    this.stops.set(userId, stop)
    return stop
  }

  private async getTicket(
    client: ILinkClient,
    userId: string,
    contextToken: string,
  ): Promise<string | null> {
    const cached = this.tickets.get(userId)
    if (cached && Date.now() - cached.fetchedAt < TICKET_TTL_MS) {
      return cached.ticket
    }
    try {
      const resp = await client.getConfig(userId, contextToken)
      const ret = Number(resp.ret ?? 0)
      const ticket = String(
        (resp as { typing_ticket?: unknown }).typing_ticket ??
          (resp as { typingTicket?: unknown }).typingTicket ??
          '',
      ).trim()
      if (ret !== 0 || !ticket) {
        log('debug', 'weixin', `getconfig no typing_ticket ret=${ret}`)
        return null
      }
      this.tickets.set(userId, { ticket, fetchedAt: Date.now() })
      return ticket
    } catch (err) {
      log('debug', 'weixin', `getconfig failed: ${String(err)}`)
      return null
    }
  }
}
