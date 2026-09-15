import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAcl, policyFromConfig } from '../../../src/main/services/channels/adapters/_shared/acl'
import {
  InboundDebouncer,
  mergeTextMessages,
} from '../../../src/main/services/channels/adapters/_shared/debounce'
import { parseFeishuOutboundMediaMarkers } from '../../../src/main/services/channels/adapters/feishu/outbound'
import { parseIncomingMessage } from '../../../src/main/services/channels/adapters/feishu/parsing'
import { feishuManifest } from '../../../src/main/services/channels/adapters/feishu/manifest'

describe('feishu ACL (QwenPaw parity)', () => {
  it('allowlist + allowGroups=false → group deny', () => {
    let p = policyFromConfig({
      allowFrom: 'ou_alice',
      aclDm: 'allowlist',
      aclGroup: 'open',
      requireMention: true,
    })
    p = { ...p, group: 'deny' }
    expect(checkAcl(p, { chatType: 'p2p', senderId: 'ou_alice' }).decision).toBe('allow')
    expect(checkAcl(p, { chatType: 'p2p', senderId: 'ou_eve' }).decision).toBe('deny')
    expect(
      checkAcl(p, { chatType: 'group', senderId: 'ou_alice', chatId: 'oc_g', mentioned: true })
        .decision,
    ).toBe('deny')
  })

  it('requireMention blocks unmentioned group', () => {
    const p = policyFromConfig({ requireMention: true, aclGroup: 'open' })
    expect(
      checkAcl(p, { chatType: 'group', senderId: 'ou_a', chatId: 'oc_g', mentioned: false })
        .decision,
    ).toBe('deny')
    expect(
      checkAcl(p, { chatType: 'group', senderId: 'ou_a', chatId: 'oc_g', mentioned: true })
        .decision,
    ).toBe('allow')
  })
})

describe('feishu parseIncomingMessage', () => {
  it('returns senderId + mentioned for group @', () => {
    const parsed = parseIncomingMessage(
      {
        message: {
          message_id: 'om_1',
          chat_id: 'oc_g',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_user_1 hi' }),
          mentions: [{ key: '@_user_1', name: 'bot', id: { open_id: 'ou_bot' } }],
        },
        sender: { sender_id: { open_id: 'ou_user' } },
      },
      { allowGroups: true, requireMention: true },
    )
    expect(parsed?.senderId).toBe('ou_user')
    expect(parsed?.mentioned).toBe(true)
    expect(parsed?.text).toContain('hi')
  })

  it('drops group without mention when requireMention', () => {
    const parsed = parseIncomingMessage(
      {
        message: {
          message_id: 'om_2',
          chat_id: 'oc_g',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello' }),
        },
        sender: { sender_id: { open_id: 'ou_user' } },
      },
      { requireMention: true },
    )
    expect(parsed).toBeNull()
  })
})

describe('feishu outbound markers', () => {
  it('parses IMAGE/FILE markers', () => {
    const { cleanedText, media } = parseFeishuOutboundMediaMarkers(
      'see [IMAGE: /tmp/a.png] and [FILE: /tmp/b.pdf] ok',
    )
    expect(media).toHaveLength(2)
    expect(media[0]!.kind).toBe('image')
    expect(media[1]!.kind).toBe('file')
    expect(cleanedText).toBe('see  and  ok')
  })
})

describe('feishu inbound debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('merges text within window', async () => {
    vi.useFakeTimers()
    const flushed: Array<{ text?: string }>[] = []
    const d = new InboundDebouncer<{ id: string; text?: string }>({
      keyOf: (x) => x.id,
      windowMs: 80,
      onAppend: mergeTextMessages,
      flush: (_k, items) => flushed.push(items),
    })
    d.push({ id: 'oc_1', text: 'a' })
    d.push({ id: 'oc_1', text: 'b' })
    await vi.advanceTimersByTimeAsync(80)
    expect(flushed[0]![0]!.text).toBe('a\nb')
  })
})

describe('feishu manifest parity fields', () => {
  it('declares ACL + debounce + card-stream', () => {
    const names = feishuManifest.configSchema.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining(['allowFrom', 'aclDm', 'aclGroup', 'requireMention', 'debounceMs']),
    )
    expect(feishuManifest.capabilities.streamingKind).toBe('card-stream')
    expect(feishuManifest.capabilities.receivesFiles).toBe(true)
  })
})
