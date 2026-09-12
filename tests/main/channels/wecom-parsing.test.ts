// =============================================================
// 企微 aibot_msg_callback 解析 — 字段提取与边界:
//   text/voice(ASR)/image/file/video/mixed、群聊过滤、
//   会话键(群=chatid/单聊=userid)、投递信息(req_id 透传)
// =============================================================

import { describe, expect, it } from 'vitest'

import { parseWecomMessage } from '../../../src/main/services/channels/adapters/wecom/parsing'

function textBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    msgid: 'msg-1',
    chattype: 'single',
    from: { userid: 'user-1' },
    msgtype: 'text',
    text: { content: ' 帮我分析三班成绩 ' },
    ...overrides,
  }
}

describe('parseWecomMessage', () => {
  it('text: 提取并 trim 文本;单聊 chatId=userid;投递信息带 reqId', () => {
    const r = parseWecomMessage(textBody(), 'req-abc')
    expect(r).not.toBeNull()
    expect(r?.parsed).toMatchObject({
      messageId: 'msg-1',
      chatId: 'user-1',
      chatType: 'p2p',
      text: '帮我分析三班成绩',
      attachments: [],
    })
    expect(r?.delivery).toMatchObject({
      reqId: 'req-abc',
      chatType: 'single',
      chatId: 'user-1',
      userId: 'user-1',
    })
  })

  it('group: chatId=chatid,chatType=group', () => {
    const r = parseWecomMessage(
      textBody({ chattype: 'group', chatid: 'chat-g-1' }),
      'req-g',
    )
    expect(r?.parsed.chatId).toBe('chat-g-1')
    expect(r?.parsed.chatType).toBe('group')
    expect(r?.delivery.chatType).toBe('group')
  })

  it('allowGroups=false 时群聊消息返回 null,单聊不受影响', () => {
    expect(
      parseWecomMessage(textBody({ chattype: 'group', chatid: 'c1' }), 'r', {
        allowGroups: false,
      }),
    ).toBeNull()
    expect(parseWecomMessage(textBody(), 'r', { allowGroups: false })).not.toBeNull()
  })

  it('voice: 用 ASR 文本;无识别结果时占位 [语音消息]', () => {
    const r = parseWecomMessage(
      textBody({ msgtype: 'voice', voice: { content: '今天谁没交作业' } }),
      'r',
    )
    expect(r?.parsed.text).toBe('今天谁没交作业')
    const fallback = parseWecomMessage(textBody({ msgtype: 'voice', voice: {} }), 'r')
    expect(fallback?.parsed.text).toBe('[语音消息]')
  })

  it('image/file/video: 附件上下文带 url+aeskey,fileKey=url', () => {
    const img = parseWecomMessage(
      textBody({ msgtype: 'image', image: { url: 'https://f.wecom.example/i', aeskey: 'k1' } }),
      'r',
    )
    expect(img?.parsed.text).toBe('[图片]')
    expect(img?.parsed.attachments[0]).toEqual({ kind: 'image', fileKey: 'https://f.wecom.example/i' })
    expect(img?.delivery.attachments[0]).toMatchObject({
      url: 'https://f.wecom.example/i',
      aesKey: 'k1',
      kind: 'image',
    })

    const file = parseWecomMessage(
      textBody({ msgtype: 'file', file: { url: 'https://f.wecom.example/f', aeskey: 'k2' } }),
      'r',
    )
    expect(file?.parsed.attachments[0]?.kind).toBe('file')
    expect(file?.delivery.attachments[0]?.kind).toBe('file')

    const video = parseWecomMessage(
      textBody({ msgtype: 'video', video: { url: 'https://f.wecom.example/v', aeskey: 'k3' } }),
      'r',
    )
    expect(video?.delivery.attachments[0]).toMatchObject({ kind: 'file', fileName: 'video.mp4' })
  })

  it('mixed: 文本拼接 + 多图附件;纯图无文本时占位 [图文消息]', () => {
    const r = parseWecomMessage(
      textBody({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: '看看这两张图' } },
            { msgtype: 'image', image: { url: 'https://f.wecom.example/1', aeskey: 'a1' } },
            { msgtype: 'image', image: { url: 'https://f.wecom.example/2', aeskey: 'a2' } },
          ],
        },
      }),
      'r',
    )
    expect(r?.parsed.text).toBe('看看这两张图')
    expect(r?.parsed.attachments).toHaveLength(2)
    expect(r?.delivery.attachments.map((a) => a.aesKey)).toEqual(['a1', 'a2'])

    const noText = parseWecomMessage(
      textBody({
        msgtype: 'mixed',
        mixed: { msg_item: [{ msgtype: 'image', image: { url: 'https://f.wecom.example/3' } }] },
      }),
      'r',
    )
    expect(noText?.parsed.text).toBe('[图文消息]')
  })

  it('缺关键字段(msgid/userid/reqId)或未知类型 → null', () => {
    expect(parseWecomMessage({}, 'r')).toBeNull()
    expect(parseWecomMessage(textBody({ msgid: '' }), 'r')).toBeNull()
    expect(parseWecomMessage(textBody({ from: {} }), 'r')).toBeNull()
    expect(parseWecomMessage(textBody(), '')).toBeNull()
    expect(parseWecomMessage(textBody({ msgtype: 'location' }), 'r')).toBeNull()
    // 空文本 text 消息 → null(无内容可处理)
    expect(parseWecomMessage(textBody({ text: { content: '   ' } }), 'r')).toBeNull()
  })
})
