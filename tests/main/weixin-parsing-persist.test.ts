// =============================================================
// weixin parsing/persist — iLink 入站解析与游标持久化纯函数测试
// 解析层是远端数据的信任边界: 非用户消息/缺发送者/空内容一律 null,
// 媒体引用编码可逆,附件缺 encrypt_query_param 丢弃,游标落盘可恢复。
// =============================================================

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn((n: string) => path.join(os.tmpdir(), 'wx-parse-test', n)), isPackaged: false },
}))
import {
  decodeWeixinMediaKey,
  encodeWeixinMediaKey,
  extractAttachmentsFromItems,
  extractTextFromItems,
  extractUpdatesPayload,
  parseWeixinMessage,
} from '../../src/main/services/channels/adapters/weixin/parsing'
import {
  loadWeixinPersist,
  saveWeixinContextTokens,
  saveWeixinCursor,
} from '../../src/main/services/channels/adapters/weixin/persist'

function textItem(text: string) {
  return { type: 1, text_item: { text } }
}

describe('weixin parsing', () => {
  it('decode/encode 媒体引用可逆;非 wxmedia 前缀与缺 enc 字段拒绝', () => {
    const meta = { kind: 'image', encryptQueryParam: 'q=1', aesKey: 'k', fileName: 'a.jpg' }
    const key = encodeWeixinMediaKey(meta)
    expect(key.startsWith('wxmedia:')).toBe(true)
    expect(decodeWeixinMediaKey(key)).toEqual(meta)
    expect(decodeWeixinMediaKey('not-a-key')).toBeNull()
    const bad = 'wxmedia:' + Buffer.from(JSON.stringify({ aesKey: 'k' }), 'utf8').toString('base64url')
    expect(decodeWeixinMediaKey(bad)).toBeNull()
    expect(decodeWeixinMediaKey('wxmedia:!!!not-base64')).toBeNull()
  })

  it('extractTextFromItems: 文本 trim 拼接;语音取 ASR,无 ASR 占位;非数组归零', () => {
    expect(extractTextFromItems(undefined)).toBe('')
    expect(
      extractTextFromItems([
        textItem('  hello '),
        { type: 3, voice_item: { text_item: { text: '识别结果' } } },
        { type: 3, voice_item: {} },
        'garbage',
      ]),
    ).toBe('hello' + String.fromCharCode(10) + '识别结果' + String.fromCharCode(10) + '[语音消息]')
  })

  it('extractAttachmentsFromItems: 图片 hex aeskey 转 base64;文件/视频缺 enc 丢弃', () => {
    const items = [
      {
        type: 2,
        image_item: { aeskey: '0011ff', media: { encrypt_query_param: 'EQ_IMG' } },
      },
      { type: 4, file_item: { file_name: 'doc.pdf', media: {} } },
      {
        type: 5,
        video_item: { media: { encrypt_query_param: 'EQ_VID', aes_key: 'rawkey' } },
      },
    ]
    const atts = extractAttachmentsFromItems(items)
    expect(atts).toHaveLength(2)
    expect(atts[0]).toMatchObject({ kind: 'image', fileName: 'image.jpg' })
    const imgMeta = decodeWeixinMediaKey(atts[0].fileKey)!
    expect(imgMeta.aesKey).toBe(Buffer.from('0011ff', 'hex').toString('base64'))
    const vidMeta = decodeWeixinMediaKey(atts[1].fileKey)!
    expect(vidMeta.kind).toBe('file')
    expect(vidMeta.fileName).toBe('video.mp4')
    expect(vidMeta.aesKey).toBe('rawkey')
  })

  it('parseWeixinMessage: 非用户消息/缺发送者/空内容均 null', () => {
    expect(parseWeixinMessage(null)).toBeNull()
    expect(parseWeixinMessage('str')).toBeNull()
    expect(parseWeixinMessage({ message_type: 2, item_list: [textItem('hi')] })).toBeNull()
    expect(parseWeixinMessage({ message_type: 1, item_list: [textItem('hi')] })).toBeNull()
    expect(parseWeixinMessage({ message_type: 1, from_user_id: 'u1@x', item_list: [] })).toBeNull()
  })

  it('parseWeixinMessage: 正常消息归一;msg_id 缺省时退位 context_token 再退位 user+时间', () => {
    const withId = parseWeixinMessage({
      message_type: 1,
      from_user_id: ' u1@wx ',
      context_token: 'ctx-7',
      msg_id: 'm-100',
      item_list: [textItem('你好')],
    }, 1234)
    expect(withId?.inbound).toMatchObject({
      channel: 'weixin',
      providerMessageId: 'm-100',
      chat: { id: 'u1@wx', type: 'p2p' },
      sender: { id: 'u1@wx', name: 'u1' },
      text: '你好',
      receivedAt: 1234,
    })
    expect(withId?.delivery).toEqual({ toUserId: 'u1@wx', contextToken: 'ctx-7' })

    const noId = parseWeixinMessage({
      message_type: 1,
      from_user_id: 'u2@wx',
      context_token: 'ctx-8',
      item_list: [textItem('hi')],
    }, 999)
    expect(noId?.inbound.providerMessageId).toBe('ctx-8')

    const nothing = parseWeixinMessage({
      message_type: 1,
      from_user_id: 'u3@wx',
      item_list: [textItem('x')],
    }, 777)
    expect(nothing?.inbound.providerMessageId).toBe('u3@wx_777')
  })

  it('parseWeixinMessage: 纯附件消息文本占位 [收到 N 个附件]', () => {
    const r = parseWeixinMessage({
      message_type: 1,
      from_user_id: 'u@wx',
      msg_id: 'm-1',
      item_list: [{ type: 2, image_item: { media: { encrypt_query_param: 'E' } } }],
    })
    expect(r?.inbound.text).toBe('[收到 1 个附件]')
    expect(r?.inbound.attachments).toHaveLength(1)
  })

  it('extractUpdatesPayload: msgs 非数组归空;游标缺省空串;ret 归一数字', () => {
    expect(extractUpdatesPayload({})).toEqual({ msgs: [], cursor: '', ret: 0 })
    expect(
      extractUpdatesPayload({ msgs: [{ a: 1 }], get_updates_buf: 'cur-2', ret: '3' }),
    ).toEqual({ msgs: [{ a: 1 }], cursor: 'cur-2', ret: 3 })
  })
})

describe('weixin persist', () => {
  it('cursor 与 context_tokens 落盘后可恢复;坏 JSON 静默归零', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wx-persist-'))
    // 空目录: 全空状态
    expect(loadWeixinPersist(dir)).toEqual({ cursor: '', contextByUser: {} })

    saveWeixinCursor(dir, 'cur-abc')
    const map = new Map([
      ['u1@wx', 't1'],
      ['u2@wx', ''],
    ])
    saveWeixinContextTokens(dir, map)
    const loaded = loadWeixinPersist(dir)
    expect(loaded.cursor).toBe('cur-abc')
    expect(loaded.contextByUser).toEqual({ 'u1@wx': 't1' })

    // 坏 JSON 归零不抛
    writeFileSync(join(dir, 'context_tokens.json'), '{oops', 'utf8')
    expect(loadWeixinPersist(dir).contextByUser).toEqual({})
    // 数组形态同样拒绝
    writeFileSync(join(dir, 'context_tokens.json'), '[1,2]', 'utf8')
    expect(loadWeixinPersist(dir).contextByUser).toEqual({})
  })
})