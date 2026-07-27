// =============================================================
// TtlLruCache 测试 — 通用 TTL + 容量上限缓存
// 行为与 eaa-handlers.ts 手写的 staticCache/scoreCache 逐字节等价
// =============================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TtlLruCache } from '../eaa-cache'

describe('TtlLruCache - 构造参数校验', () => {
  it('ttlMs <= 0 抛错', () => {
    expect(() => new TtlLruCache<string>({ ttlMs: 0, maxEntries: 10 })).toThrow(
      'ttlMs must be positive',
    )
    expect(() => new TtlLruCache<string>({ ttlMs: -1, maxEntries: 10 })).toThrow(
      'ttlMs must be positive',
    )
  })

  it('maxEntries <= 0 抛错', () => {
    expect(() => new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 0 })).toThrow(
      'maxEntries must be positive',
    )
    expect(() => new TtlLruCache<string>({ ttlMs: 1000, maxEntries: -1 })).toThrow(
      'maxEntries must be positive',
    )
  })
})

describe('TtlLruCache - 基础操作', () => {
  it('set 后 get 返回值', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', 'hello')
    expect(cache.get('a')).toBe('hello')
    expect(cache.size()).toBe(1)
  })

  it('未命中的 key 返回 null', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    expect(cache.get('missing')).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('clear 清空所有条目', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.size()).toBe(0)
    expect(cache.get('a')).toBeNull()
  })

  it('覆盖已存在的 key 不增加 size', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', '1')
    cache.set('a', '2')
    expect(cache.size()).toBe(1)
    expect(cache.get('a')).toBe('2')
  })

  it('delete 删除指定 key 并返回是否存在', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', '1')
    expect(cache.delete('a')).toBe(true)
    expect(cache.get('a')).toBeNull()
    expect(cache.delete('a')).toBe(false)
  })
})

describe('TtlLruCache - TTL 过期', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('TTL 内命中,TTL 外过期且条目被删除', () => {
    vi.useFakeTimers()
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', 'hello')
    expect(cache.get('a')).toBe('hello')

    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe('hello') // 还在 TTL 内

    vi.advanceTimersByTime(2) // 累计 1001ms,超过 TTL
    expect(cache.get('a')).toBeNull() // 过期返回 null
    expect(cache.size()).toBe(0) // 且条目被主动删除
  })

  it('get 未命中的 key 不影响其他条目', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 1000, maxEntries: 10 })
    cache.set('a', '1')
    expect(cache.get('missing')).toBeNull()
    expect(cache.size()).toBe(1)
    expect(cache.get('a')).toBe('1')
  })
})

describe('TtlLruCache - 容量上限 LRU 驱逐', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('超容量时删除 ts 最旧的条目', () => {
    vi.useFakeTimers()
    const cache = new TtlLruCache<string>({ ttlMs: 100_000, maxEntries: 3 })
    cache.set('a', '1') // ts=0
    vi.advanceTimersByTime(100)
    cache.set('b', '2') // ts=100
    vi.advanceTimersByTime(100)
    cache.set('c', '3') // ts=200
    expect(cache.size()).toBe(3)

    vi.advanceTimersByTime(100)
    cache.set('d', '4') // ts=300, 超容量,'a'(ts=0 最旧)被驱逐
    expect(cache.size()).toBe(3)
    expect(cache.get('a')).toBeNull() // 最旧的 a 被驱逐
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
    expect(cache.get('d')).toBe('4')
  })

  it('覆盖已存在 key 时不触发驱逐', () => {
    vi.useFakeTimers()
    const cache = new TtlLruCache<string>({ ttlMs: 100_000, maxEntries: 2 })
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.size()).toBe(2)
    cache.set('a', 'updated') // 覆盖,不驱逐
    expect(cache.size()).toBe(2)
    expect(cache.get('a')).toBe('updated')
    expect(cache.get('b')).toBe('2')
  })

  it('maxEntries=1 时每次 set 都驱逐旧的', () => {
    const cache = new TtlLruCache<string>({ ttlMs: 100_000, maxEntries: 1 })
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.size()).toBe(1)
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('2')
  })
})
