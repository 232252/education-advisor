import { describe, expect, it, vi } from 'vitest'
import { checkAcl, policyFromConfig } from '../../../src/main/services/channels/adapters/_shared/acl'
import { InboundDebouncer, mergeTextMessages } from '../../../src/main/services/channels/adapters/_shared/debounce'
import { createBackoffState, nextBackoffDelay, resetBackoff } from '../../../src/main/services/channels/adapters/_shared/reconnect'
import { HealthTracker } from '../../../src/main/services/channels/adapters/_shared/health'

describe('shared ACL', () => {
  it('open allows; allowlist filters; denyFrom wins', () => {
    expect(
      checkAcl({ dm: 'open', group: 'open', allowFrom: [] }, { chatType: 'p2p', senderId: 'a' })
        .decision,
    ).toBe('allow')
    expect(
      checkAcl(
        { dm: 'allowlist', group: 'open', allowFrom: ['b'] },
        { chatType: 'p2p', senderId: 'a' },
      ).decision,
    ).toBe('deny')
    expect(
      checkAcl(
        { dm: 'open', group: 'open', allowFrom: [], denyFrom: ['a'] },
        { chatType: 'p2p', senderId: 'a' },
      ).decision,
    ).toBe('deny')
    expect(
      checkAcl(
        { dm: 'open', group: 'open', allowFrom: [], pendingFrom: ['a'] },
        { chatType: 'p2p', senderId: 'a' },
      ).decision,
    ).toBe('pending')
  })

  it('policyFromConfig parses lists', () => {
    const p = policyFromConfig({ allowFrom: 'x, y', aclDm: 'allowlist', requireMention: true })
    expect(p.allowFrom).toEqual(['x', 'y'])
    expect(p.dm).toBe('allowlist')
    expect(p.requireMention).toBe(true)
  })
})

describe('shared debounce', () => {
  it('batches by key within window', async () => {
    vi.useFakeTimers()
    const flushed: Array<{ key: string; n: number }> = []
    const d = new InboundDebouncer<{ id: string; text: string }>({
      keyOf: (x) => x.id,
      windowMs: 100,
      flush: (key, items) => flushed.push({ key, n: items.length }),
      onAppend: mergeTextMessages,
    })
    d.push({ id: 'c1', text: 'a' })
    d.push({ id: 'c1', text: 'b' })
    expect(flushed).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(flushed).toEqual([{ key: 'c1', n: 1 }])
    vi.useRealTimers()
  })
})

describe('shared reconnect/health', () => {
  it('backoff advances then resets', () => {
    const s = createBackoffState({ delaysMs: [10, 20], maxAttempts: 3 })
    expect(nextBackoffDelay(s)).toBe(10)
    expect(nextBackoffDelay(s)).toBe(20)
    expect(nextBackoffDelay(s)).toBe(20)
    expect(nextBackoffDelay(s)).toBeNull()
    resetBackoff(s)
    expect(nextBackoffDelay(s)).toBe(10)
  })

  it('health tracker counts', () => {
    const h = new HealthTracker()
    h.inc('inbound')
    h.markConnected('ok')
    expect(h.snapshot().counters.inbound).toBe(1)
    expect(h.snapshot().status).toBe('connected')
  })
})
