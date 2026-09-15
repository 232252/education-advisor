// =============================================================
// _shared/debounce — inbound time-merge (QwenPaw BaseChannel parity)
// =============================================================

export type DebounceKey = string

export interface DebounceOptions<T> {
  /** Same key = same conversation; default identity stringifier */
  keyOf: (item: T) => DebounceKey
  /** Window in ms; 0 disables */
  windowMs: number
  /** Called with merged batch when timer fires */
  flush: (key: DebounceKey, items: T[]) => void
  /**
   * Optional merge: replace buffer with returned array.
   * Default = append.
   */
  onAppend?: (existing: T[], incoming: T) => T[]
}

/**
 * Time debounce buffer: payloads with the same key within windowMs
 * are batched then flushed once (QwenPaw `_debounce_seconds` pattern).
 */
export class InboundDebouncer<T> {
  private pending = new Map<DebounceKey, T[]>()
  private timers = new Map<DebounceKey, ReturnType<typeof setTimeout>>()
  private readonly opts: DebounceOptions<T>

  constructor(opts: DebounceOptions<T>) {
    this.opts = opts
  }

  /** Push an item; may flush immediately if windowMs <= 0. */
  push(item: T): void {
    const key = this.opts.keyOf(item)
    if (this.opts.windowMs <= 0) {
      this.opts.flush(key, [item])
      return
    }
    const existing = this.pending.get(key) ?? []
    const next = this.opts.onAppend ? this.opts.onAppend(existing, item) : [...existing, item]
    this.pending.set(key, next)
    const prev = this.timers.get(key)
    if (prev) clearTimeout(prev)
    this.timers.set(
      key,
      setTimeout(() => this.flushKey(key), this.opts.windowMs),
    )
  }

  flushKey(key: DebounceKey): void {
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.delete(key)
    const items = this.pending.get(key)
    this.pending.delete(key)
    if (items?.length) this.opts.flush(key, items)
  }

  flushAll(): void {
    for (const key of [...this.pending.keys()]) this.flushKey(key)
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.pending.clear()
  }

  get size(): number {
    return this.pending.size
  }
}

/** Merge consecutive text chunks: join with newline, keep last as base meta. */
export function mergeTextMessages<T extends { text?: string }>(
  existing: T[],
  incoming: T,
): T[] {
  if (existing.length === 0) return [incoming]
  const last = existing[existing.length - 1]!
  const merged = {
    ...last,
    ...incoming,
    text: [last.text, incoming.text].filter(Boolean).join('\n'),
  } as T
  return [...existing.slice(0, -1), merged]
}
