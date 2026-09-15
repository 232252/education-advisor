import { beforeAll, describe, expect, it } from 'vitest'
import {
  beijingTimestamp,
  computeSignature,
  generateNonce,
} from '../../../src/main/services/channels/adapters/yuanbao/auth'
import {
  buildAuthBindMsg,
  buildPingMsg,
  buildSendC2cMsg,
  decodeConnMsg,
  encodePb,
  decodeInboundMessage,
  extractTextFromMsgBody,
  initYuanbaoProto,
  resetCodecForTests,
} from '../../../src/main/services/channels/adapters/yuanbao/codec'
import {
  CMD_AUTH_BIND,
  CMD_PING,
  CMD_TYPE_REQUEST,
  INBOUND_MSG_PUSH,
  MODULE_CONN_ACCESS,
} from '../../../src/main/services/channels/adapters/yuanbao/constants'

describe('yuanbao auth', () => {
  it('HMAC signature is stable hex', () => {
    const sig = computeSignature('nonce', '2026-01-01T00:00:00+08:00', 'app', 'secret')
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    expect(generateNonce()).toHaveLength(32)
    expect(beijingTimestamp()).toMatch(/\+08:00$/)
  })
})

describe('yuanbao codec roundtrip', () => {
  beforeAll(() => {
    resetCodecForTests()
    initYuanbaoProto()
  })

  it('AuthBind encode → ConnMsg decode', () => {
    const raw = buildAuthBindMsg({
      bizId: 'ybBot',
      uid: 'bot-1',
      source: 'bot',
      token: 'tok-xyz',
    })
    expect(raw).toBeInstanceOf(Buffer)
    expect(raw!.length).toBeGreaterThan(20)
    const decoded = decodeConnMsg(raw!)
    expect(decoded?.head.cmd).toBe(CMD_AUTH_BIND)
    expect(decoded?.head.module).toBe(MODULE_CONN_ACCESS)
    expect(decoded?.head.cmdType).toBe(CMD_TYPE_REQUEST)
    expect(decoded!.data.length).toBeGreaterThan(0)
  })

  it('Ping encode/decode head', () => {
    const raw = buildPingMsg()
    expect(raw).toBeTruthy()
    const decoded = decodeConnMsg(raw!)
    expect(decoded?.head.cmd).toBe(CMD_PING)
  })

  it('SendC2C text body', () => {
    const built = buildSendC2cMsg({
      toAccount: 'user-1',
      fromAccount: 'bot-1',
      msgBody: [{ msg_type: 'TIMTextElem', msg_content: { text: '你好' } }],
    })
    expect(built?.msgId).toMatch(/^[a-f0-9]+$/)
    const decoded = decodeConnMsg(built!.raw)
    expect(decoded?.head.cmd).toBe('send_c2c_message')
  })

  it('extractTextFromMsgBody joins text elems', () => {
    expect(
      extractTextFromMsgBody([
        { msg_type: 'TIMTextElem', msg_content: { text: 'a' } },
        { msg_type: 'TIMTextElem', msg_content: { text: 'b' } },
      ]),
    ).toBe('a\nb')
  })

  it('InboundMessagePush decode', () => {
    const bin = encodePb(INBOUND_MSG_PUSH, {
      fromAccount: 'u1',
      toAccount: 'bot',
      senderNickname: 'Nick',
      groupCode: '',
      msgId: 'm1',
      msgBody: [{ msgType: 'TIMTextElem', msgContent: { text: 'hello' } }],
      clawMsgType: 2,
    })
    expect(bin).toBeTruthy()
    const inbound = decodeInboundMessage(bin!)
    expect(inbound?.from_account).toBe('u1')
    expect(inbound?.msg_body[0]?.msg_content.text).toBe('hello')
    expect(extractTextFromMsgBody(inbound!.msg_body)).toBe('hello')
  })
})
