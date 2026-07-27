// =============================================================
// EAA 通用 TTL + 容量上限缓存
// 替换 eaa-handlers.ts 内手写的 staticCache / scoreCache
// 行为与原手写实现逐字节等价(含"过期主动删除"和"超容量删最旧"策略)
// =============================================================

interface CacheEntry<T> {
  data: T
  ts: number
}

export class TtlLruCache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(opts: { ttlMs: number; maxEntries: number }) {
    if (opts.ttlMs <= 0) throw new Error('ttlMs must be positive')
    if (opts.maxEntries <= 0) throw new Error('maxEntries must be positive')
    this.ttlMs = opts.ttlMs
    this.maxEntries = opts.maxEntries
  }

  /** 命中且未过期返回值;过期则主动删除并返回 null(与 eaa-handlers 原实现一致) */
  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts >= this.ttlMs) {
      this.entries.delete(key)
      return null
    }
    return entry.data
  }

  /** 插入条目;超容量且 key 不存在时,先删 ts 最小的条目 */
  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      let oldestKey: string | null = null
      let oldestTs = Infinity
      for (const [k, v] of this.entries) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts
          oldestKey = k
        }
      }
      if (oldestKey) this.entries.delete(oldestKey)
    }
    this.entries.set(key, { data: value, ts: Date.now() })
  }

  clear(): void {
    this.entries.clear()
  }

  /** 删除指定 key,返回是否存在该条目 */
  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  size(): number {
    return this.entries.size
  }
}
