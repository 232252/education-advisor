// =============================================================
// channel-catalog — 分组/搜索/状态推导纯函数
// =============================================================

import { describe, expect, it } from 'vitest'
import type { ChannelManifest } from '@shared/types'
import {
  buildQwenpawPendingManifests,
  filterCatalogManifests,
  groupCatalogManifests,
  pickPrimaryChannelIds,
  resolveCatalogGroup,
  resolveCatalogStatus,
} from '../../../src/shared/channel-catalog'

function base(partial: Partial<ChannelManifest> & Pick<ChannelManifest, 'id' | 'label'>): ChannelManifest {
  return {
    description: 'd',
    icon: partial.id,
    capabilities: {
      receivesVia: 'ws',
      streamingKind: 'none',
      canSendCard: false,
      maxTextLength: null,
      replyWindowMs: null,
      streamWindowMs: null,
      pushPolicy: 'free',
      receivesFiles: false,
    },
    configSchema: [],
    ...partial,
  }
}

describe('resolveCatalogStatus', () => {
  it('unsupportedReason 无显式 status 时视为 unsupported', () => {
    expect(
      resolveCatalogStatus(base({ id: 'onebot', label: 'OneBot', unsupportedReason: '合规' })),
    ).toBe('unsupported')
  })
  it('later 可携带 unsupportedReason 仍为 later', () => {
    expect(
      resolveCatalogStatus(
        base({
          id: 'sip',
          label: 'SIP',
          catalogStatus: 'later',
          unsupportedReason: '需媒体栈',
        }),
      ),
    ).toBe('later')
  })
  it('later / comingSoon / enabled', () => {
    expect(resolveCatalogStatus(base({ id: 'a', label: 'A', catalogStatus: 'later' }))).toBe('later')
    expect(resolveCatalogStatus(base({ id: 'b', label: 'B', comingSoon: true }))).toBe('comingSoon')
    expect(resolveCatalogStatus(base({ id: 'c', label: 'C', catalogStatus: 'enabled' }))).toBe(
      'enabled',
    )
  })
})

describe('groupCatalogManifests', () => {
  it('按国内优先分组且组内 priority 升序', () => {
    const buckets = groupCatalogManifests([
      base({ id: 'qq', label: 'QQ', category: 'consumer-im', priority: 21 }),
      base({ id: 'feishu', label: '飞书', category: 'enterprise-im', priority: 10 }),
      base({
        id: 'discord',
        label: 'Discord',
        category: 'overseas',
        region: 'foreign',
        priority: 70,
        catalogStatus: 'enabled',
      }),
      base({
        id: 'onebot',
        label: 'OneBot',
        catalogStatus: 'unsupported',
        unsupportedReason: '禁',
        priority: 90,
      }),
    ])
    expect(buckets.map((b) => b.group.id)).toEqual([
      'enterprise-im',
      'consumer-im',
      'overseas',
      'unsupported',
    ])
    expect(buckets[0].items.map((m) => m.id)).toEqual(['feishu'])
    expect(buckets.find((b) => b.group.id === 'unsupported')?.items[0].id).toBe('onebot')
  })
})

describe('filterCatalogManifests', () => {
  it('按 label / qwenpawKey 过滤', () => {
    const list = [
      base({ id: 'weixin', label: '微信', qwenpawKey: 'wechat' }),
      base({ id: 'qq', label: 'QQ', qwenpawKey: 'qq' }),
    ]
    expect(filterCatalogManifests(list, 'wechat').map((m) => m.id)).toEqual(['weixin'])
    expect(filterCatalogManifests(list, 'qq').map((m) => m.id)).toEqual(['qq'])
    expect(filterCatalogManifests(list, '')).toHaveLength(2)
  })
})

describe('pickPrimaryChannelIds', () => {
  it('只取 enabled 且非 foreign,按 priority', () => {
    const ids = pickPrimaryChannelIds(
      [
        base({ id: 'feishu', label: '飞书', region: 'domestic', priority: 10 }),
        base({ id: 'discord', label: 'Discord', region: 'foreign', catalogStatus: 'enabled' }),
        base({ id: 'mqtt', label: 'MQTT', region: 'neutral', comingSoon: true }),
        base({ id: 'qq', label: 'QQ', region: 'domestic', priority: 21 }),
      ],
      6,
    )
    expect(ids).toEqual(['feishu', 'qq'])
  })
})

describe('buildQwenpawPendingManifests', () => {
  it('仅保留重依赖 later/unsupported;海外 Bot 已迁出 pending', () => {
    const pending = buildQwenpawPendingManifests()
    const ids = pending.map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining(['onebot', 'azure-bot', 'sip', 'voice', 'imessage']))
    expect(ids).not.toContain('discord')
    expect(ids).not.toContain('telegram')
    expect(ids).not.toContain('slack')
    expect(ids).not.toContain('matrix')
    expect(ids).not.toContain('mattermost')
    expect(ids).not.toContain('yuanbao')
    expect(ids).not.toContain('mqtt')
    expect(ids).not.toContain('email')
    expect(ids).not.toContain('feishu')
    expect(ids).not.toContain('weixin')
    const onebot = pending.find((m) => m.id === 'onebot')!
    expect(resolveCatalogStatus(onebot)).toBe('unsupported')
    expect(resolveCatalogGroup(onebot)).toBe('unsupported')
    const sip = pending.find((m) => m.id === 'sip')!
    expect(resolveCatalogStatus(sip)).toBe('later')
    expect(sip.unsupportedReason).toBeTruthy()
    expect(resolveCatalogGroup(sip)).toBe('voice')
  })
})
