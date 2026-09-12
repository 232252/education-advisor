// =============================================================
// 钉钉消息解析 — 回调 payload → 队列消息 + 投递信息
// 事实锚点: 官方连接器 message-handler.ts 字段结构(2026-09-12 核验)。
// =============================================================

import { describe, expect, it } from 'vitest'
import { parseDingtalkMessage } from '../../../src/main/services/channels/adapters/dingtalk/parsing'

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    msgtype: 'text',
    msgId: 'msg-001',
    conversationType: '1',
    conversationId: 'cid-abc',
    senderStaffId: 'staff-1',
    senderNick: '张老师',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=xyz',
    text: { content: '帮我看看成绩' },
    ...overrides,
  }
}

describe('parseDingtalkMessage(text)', () => {
  it('单聊文本 → p2p 队列消息 + 完整投递信息', () => {
    const r = parseDingtalkMessage(basePayload())
    expect(r).not.toBeNull()
    expect(r?.parsed).toEqual({
      text: '帮我看看成绩',
      messageId: 'msg-001',
      chatId: 'staff-1',
      chatType: 'p2p',
      attachments: [],
    })
    expect(r?.delivery).toMatchObject({
      sessionWebhook: expect.stringContaining('sendBySession'),
      conversationType: '1',
      senderStaffId: 'staff-1',
      senderNick: '张老师',
    })
  })

  it('群聊文本 → group,chatId = conversationId', () => {
    const r = parseDingtalkMessage(basePayload({ conversationType: '2' }))
    expect(r?.parsed.chatId).toBe('cid-abc')
    expect(r?.parsed.chatType).toBe('group')
  })

  it('allowGroups=false 时群聊消息被过滤(只响应私聊)', () => {
    const r = parseDingtalkMessage(basePayload({ conversationType: '2' }), {
      allowGroups: false,
    })
    expect(r).toBeNull()
  })

  it('空文本(纯 @ 机器人) → null', () => {
    const r = parseDingtalkMessage(basePayload({ text: { content: '' } }))
    expect(r).toBeNull()
  })

  it('缺关键字段(sessionWebhook/senderStaffId) → null', () => {
    expect(parseDingtalkMessage(basePayload({ sessionWebhook: '' }))).toBeNull()
    expect(parseDingtalkMessage(basePayload({ senderStaffId: '', senderId: '' }))).toBeNull()
  })
})

describe('parseDingtalkMessage(附件类型)', () => {
  it('picture → image 附件(downloadCode 为 fileKey)', () => {
    const r = parseDingtalkMessage(
      basePayload({ msgtype: 'picture', content: { downloadCode: 'dc-1' } }),
    )
    expect(r?.parsed.text).toBe('[图片]')
    expect(r?.parsed.attachments).toEqual([
      { kind: 'image', fileKey: 'dc-1', fileName: 'image.png' },
    ])
  })

  it('file → file 附件带原始文件名', () => {
    const r = parseDingtalkMessage(
      basePayload({ msgtype: 'file', content: { downloadCode: 'dc-2', fileName: '期中成绩.xlsx' } }),
    )
    expect(r?.parsed.text).toBe('[文件]')
    expect(r?.parsed.attachments[0]).toMatchObject({ kind: 'file', fileKey: 'dc-2', fileName: '期中成绩.xlsx' })
  })

  it('audio → ASR 文本 + 音频附件;无 recognition 时兜底提示', () => {
    const r = parseDingtalkMessage(
      basePayload({ msgtype: 'audio', content: { downloadCode: 'dc-3', recognition: '明天放假吗' } }),
    )
    expect(r?.parsed.text).toBe('明天放假吗')
    expect(r?.parsed.attachments[0]?.fileKey).toBe('dc-3')
    const r2 = parseDingtalkMessage(
      basePayload({ msgtype: 'audio', content: { downloadCode: 'dc-4' } }),
    )
    expect(r2?.parsed.text).toBe('[语音消息]')
  })

  it('content 为 JSON 字符串的旧结构也能解出 downloadCode', () => {
    const r = parseDingtalkMessage(
      basePayload({
        msgtype: 'file',
        content: JSON.stringify({ downloadCode: 'dc-5', fileName: 'old.txt' }),
      }),
    )
    expect(r?.parsed.attachments[0]).toMatchObject({ fileKey: 'dc-5', fileName: 'old.txt' })
  })

  it('richText → 拼接文字段 + 提取 downloadCode 附件', () => {
    const r = parseDingtalkMessage(
      basePayload({
        msgtype: 'richText',
        content: {
          richText: [
            { text: '看看' },
            { text: '这个文件', downloadCode: 'dc-6', fileName: '报告.docx' },
          ],
        },
      }),
    )
    expect(r?.parsed.text).toBe('看看这个文件')
    expect(r?.parsed.attachments).toEqual([
      { kind: 'file', fileKey: 'dc-6', fileName: '报告.docx' },
    ])
  })

  it('不支持的消息类型 → null', () => {
    expect(parseDingtalkMessage(basePayload({ msgtype: 'unknownType' }))).toBeNull()
    expect(parseDingtalkMessage('not-an-object')).toBeNull()
  })
})
