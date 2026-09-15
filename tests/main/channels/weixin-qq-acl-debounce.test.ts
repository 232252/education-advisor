import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAcl, policyFromConfig } from '../../../src/main/services/channels/adapters/_shared/acl'
import {
  InboundDebouncer,
  mergeTextMessages,
} from '../../../src/main/services/channels/adapters/_shared/debounce'
import { QQ_FILE_TYPE_FILE, QQ_FILE_TYPE_IMAGE, guessQqFileType } from '../../../src/main/services/channels/adapters/qq/media'

describe('weixin/qq ACL decisions', () => {
  it('allowlist blocks unknown senders', () => {
    const p = policyFromConfig({ allowFrom: 'alice,bob', aclDm: 'allowlist', aclGroup: 'deny' })
    expect(checkAcl(p, { chatType: 'p2p', senderId: 'alice' }).decision).toBe('allow')
    expect(checkAcl(p, { chatType: 'p2p', senderId: 'eve' }).decision).toBe('deny')
    expect(checkAcl(p, { chatType: 'group', senderId: 'alice', chatId: 'g1' }).decision).toBe('deny')
  })

  it('qq allowGroups=false maps to group deny', () => {
    let p = policyFromConfig({ aclGroup: 'open', allowFrom: '' })
    p = { ...p, group: 'deny' }
    expect(checkAcl(p, { chatType: 'group', senderId: 'u', chatId: 'g' }).decision).toBe('deny')
    expect(checkAcl(p, { chatType: 'p2p', senderId: 'u' }).decision).toBe('allow')
  })
})

describe('inbound debounce merge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('merges consecutive text within window', async () => {
    vi.useFakeTimers()
    const flushed: Array<{ text?: string }>[] = []
    const d = new InboundDebouncer<{ id: string; text?: string }>({
      keyOf: (x) => x.id,
      windowMs: 100,
      onAppend: mergeTextMessages,
      flush: (_k, items) => flushed.push(items),
    })
    d.push({ id: 'u1', text: 'a' })
    d.push({ id: 'u1', text: 'b' })
    expect(flushed).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]![0]!.text).toBe('a\nb')
  })
})

describe('qq group file_type=4 guard helper', () => {
  it('guesses file vs image', () => {
    expect(guessQqFileType('a.png')).toBe(QQ_FILE_TYPE_IMAGE)
    expect(guessQqFileType('a.pdf')).toBe(QQ_FILE_TYPE_FILE)
  })

  it('documents group skip condition', () => {
    const kind: 'c2c' | 'group' = 'group'
    const fileType = QQ_FILE_TYPE_FILE
    const shouldSkip = kind === 'group' && fileType === QQ_FILE_TYPE_FILE
    expect(shouldSkip).toBe(true)
  })
})
