// =============================================================
// _shared/health — adapter diagnostics snapshot helpers
// =============================================================

export interface ChannelHealthSnapshot {
  status: string
  detail?: string
  connectedAt?: number
  lastMessageAt?: number
  lastErrorAt?: number
  reconnectAttempt?: number
  /** Free-form counters (ws frames, auth binds, heartbeats, …) */
  counters: Record<string, number>
  /** Optional last error message */
  lastError?: string
}

export class HealthTracker {
  private counters: Record<string, number> = {}
  private lastError?: string
  connectedAt?: number
  lastMessageAt?: number
  lastErrorAt?: number
  reconnectAttempt = 0
  status = 'disabled'
  detail?: string

  inc(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by
  }

  setError(msg: string): void {
    this.lastError = msg
    this.lastErrorAt = Date.now()
    this.inc('errors')
  }

  markConnected(detail?: string): void {
    this.status = 'connected'
    this.connectedAt = Date.now()
    this.reconnectAttempt = 0
    this.detail = detail
  }

  snapshot(): ChannelHealthSnapshot {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
      reconnectAttempt: this.reconnectAttempt,
      counters: { ...this.counters },
      lastError: this.lastError,
    }
  }

  reset(): void {
    this.counters = {}
    this.lastError = undefined
    this.connectedAt = undefined
    this.lastMessageAt = undefined
    this.lastErrorAt = undefined
    this.reconnectAttempt = 0
    this.status = 'disabled'
    this.detail = undefined
  }
}
