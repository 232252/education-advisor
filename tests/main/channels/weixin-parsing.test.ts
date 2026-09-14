import { describe, expect, it } from 'vitest'
import {
  extractTextFromItems,
  extractUpdatesPayload,
  parseWeixinMessage,
} from '../../../src/main/services/channels/adapters/weixin/parsing'
import { normalizeQrStatus } from '../../../src/main/services/channels/adapters/weixin/headers'
import { validateManifest } from '../../../src/main/services/channels/manifest'
import { weixinManifest } from '../../../src/main/services/channels/adapters/weixin/manifest'

describe('weixin parsing + manifest', () => {
  it('manifest 通过校验且含扫码与限制横幅', () => {
    expect(validateManifest(weixinManifest)).toEqual([])
    expect(weixinManifest.loginKinds).toContain('qr')
    expect(weixinManifest.limitationBannerKey).toBe('channels.weixin.limitation')
    expect(weixinManifest.capabilities.pushPolicy).toBe('require-prior-message')
    expect(weixinManifest.capabilities.receivesVia).toBe('polling')
  })

  it('normalizeQrStatus 兼容官方拼写变体', () => {
    expect(normalizeQrStatus('waiting')).toBe('pending')
    expect(normalizeQrStatus('scaned')).toBe('scanned')
    expect(normalizeQrStatus('scanned')).toBe('scanned')
    expect(normalizeQrStatus('confirmed')).toBe('confirmed')
    expect(normalizeQrStatus('expired')).toBe('expired')
  })

  it('extractTextFromItems 拼接文本 item', () => {
    expect(
      extractTextFromItems([
        { type: 1, text_item: { text: '你好' } },
        { type: 1, text_item: { text: '助教' } },
      ]),
    ).toBe('你好\n助教')
  })

  it('parseWeixinMessage 归一化用户私聊文本', () => {
    const parsed = parseWeixinMessage({
      message_type: 1,
      from_user_id: 'u1@im.wechat',
      context_token: 'ctx-1',
      item_list: [{ type: 1, text_item: { text: '帮我总结班会' } }],
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.inbound.channel).toBe('weixin')
    expect(parsed!.inbound.chat.type).toBe('p2p')
    expect(parsed!.inbound.text).toBe('帮我总结班会')
    expect(parsed!.delivery.contextToken).toBe('ctx-1')
  })

  it('忽略 bot 发出的消息', () => {
    expect(
      parseWeixinMessage({
        message_type: 2,
        from_user_id: 'bot',
        context_token: 'x',
        item_list: [{ type: 1, text_item: { text: 'hi' } }],
      }),
    ).toBeNull()
  })

  it('extractUpdatesPayload 读取游标', () => {
    const { msgs, cursor } = extractUpdatesPayload({
      msgs: [{ a: 1 }],
      get_updates_buf: 'buf-2',
    })
    expect(msgs).toHaveLength(1)
    expect(cursor).toBe('buf-2')
  })
})
