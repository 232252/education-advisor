// =============================================================
// yuanbao/codec — ConnMsg protobuf encode/decode via protobufjs
// Descriptors: proto/conn.json + proto/biz.json (QwenPaw yuanbao/proto)
// =============================================================

import { randomBytes, randomInt } from 'node:crypto'
import protobuf from 'protobufjs'
import connJson from './proto/conn.json'
import bizJson from './proto/biz.json'
import {
  AUTH_BIND_REQ,
  AUTH_BIND_RSP,
  BIZ_CMD_GROUP_HB,
  BIZ_CMD_PRIVATE_HB,
  BIZ_CMD_SEND_C2C,
  BIZ_CMD_SEND_GROUP,
  CMD_AUTH_BIND,
  CMD_PING,
  CMD_TYPE_PUSH_ACK,
  CMD_TYPE_REQUEST,
  CONN_MSG,
  INBOUND_MSG_PUSH,
  KICKOUT_MSG,
  MODULE_BIZ,
  MODULE_CONN_ACCESS,
  PING_REQ,
  PING_RSP,
  SEND_C2C_REQ,
  SEND_C2C_RSP,
  SEND_GROUP_HB_REQ,
  SEND_GROUP_REQ,
  SEND_GROUP_RSP,
  SEND_PRIVATE_HB_REQ,
} from './constants'

export interface ConnHead {
  cmdType: number
  cmd: string
  seqNo: number
  msgId: string
  module: string
  needAck?: boolean
  status?: number
}

export interface ConnMsgDecoded {
  head: ConnHead
  data: Buffer
}

export interface InboundYuanbaoMessage {
  callback_command: string
  from_account: string
  to_account: string
  sender_nickname: string
  group_code: string
  group_name: string
  msg_seq: number
  msg_time: number
  msg_key: string
  msg_id: string
  msg_body: Array<{ msg_type: string; msg_content: Record<string, unknown> }>
  bot_owner_id: string
  claw_msg_type: number
}

let root: protobuf.Root | null = null
let seqCounter = 0

export function initYuanbaoProto(connOverride?: object, bizOverride?: object): protobuf.Root {
  if (root && !connOverride && !bizOverride) return root
  const r = new protobuf.Root()
  const conn = (connOverride ?? connJson) as { nested: Record<string, unknown> }
  const biz = (bizOverride ?? bizJson) as { nested: Record<string, unknown> }
  r.addJSON(conn.nested as never)
  r.addJSON(biz.nested as never)
  r.resolveAll()
  root = r
  return r
}

function getRoot(): protobuf.Root {
  return root ?? initYuanbaoProto()
}

function lookup(typeName: string): protobuf.Type {
  return getRoot().lookupType(typeName)
}

function nextSeq(): number {
  seqCounter += 1
  if (seqCounter >= 2 ** 31) seqCounter = 0
  return seqCounter
}

export function generateMsgId(): string {
  return randomBytes(16).toString('hex')
}

export function encodePb(typeName: string, data: Record<string, unknown>): Buffer | null {
  try {
    const T = lookup(typeName)
    const err = T.verify(data)
    // verify may fail on optional empty; still attempt encode
    void err
    const msg = T.create(data)
    return Buffer.from(T.encode(msg).finish())
  } catch {
    return null
  }
}

export function decodePb(typeName: string, data: Buffer | Uint8Array): Record<string, unknown> | null {
  try {
    const T = lookup(typeName)
    const msg = T.decode(data)
    return T.toObject(msg, {
      longs: Number,
      enums: Number,
      bytes: Buffer,
      defaults: false,
    }) as Record<string, unknown>
  } catch {
    return null
  }
}

export function encodeConnMsg(head: ConnHead, inner?: Buffer | null): Buffer | null {
  try {
    const T = lookup(CONN_MSG)
    const payload: Record<string, unknown> = {
      head: {
        cmdType: head.cmdType,
        cmd: head.cmd,
        seqNo: head.seqNo,
        msgId: head.msgId,
        module: head.module,
        needAck: head.needAck ?? false,
        status: head.status ?? 0,
      },
    }
    if (inner && inner.length) payload.data = inner
    const msg = T.create(payload)
    return Buffer.from(T.encode(msg).finish())
  } catch {
    return null
  }
}

export function decodeConnMsg(raw: Buffer | Uint8Array): ConnMsgDecoded | null {
  try {
    const T = lookup(CONN_MSG)
    const msg = T.decode(raw) as protobuf.Message & {
      head?: {
        cmdType?: number
        cmd?: string
        seqNo?: number
        msgId?: string
        module?: string
        needAck?: boolean
        status?: number
      }
      data?: Uint8Array
    }
    const h = msg.head ?? {}
    return {
      head: {
        cmdType: Number(h.cmdType ?? 0),
        cmd: String(h.cmd ?? ''),
        seqNo: Number(h.seqNo ?? 0),
        msgId: String(h.msgId ?? ''),
        module: String(h.module ?? ''),
        needAck: Boolean(h.needAck),
        status: Number(h.status ?? 0),
      },
      data: Buffer.from(msg.data ?? []),
    }
  } catch {
    return null
  }
}

export function buildAuthBindMsg(opts: {
  bizId: string
  uid: string
  source: string
  token: string
  routeEnv?: string
}): Buffer | null {
  const payload: Record<string, unknown> = {
    bizId: opts.bizId,
    authInfo: { uid: opts.uid, source: opts.source, token: opts.token },
    deviceInfo: { instanceId: '16' },
  }
  if (opts.routeEnv) payload.envName = opts.routeEnv
  const authData = encodePb(AUTH_BIND_REQ, payload)
  if (!authData) return null
  return encodeConnMsg(
    {
      cmdType: CMD_TYPE_REQUEST,
      cmd: CMD_AUTH_BIND,
      seqNo: nextSeq(),
      msgId: generateMsgId(),
      module: MODULE_CONN_ACCESS,
    },
    authData,
  )
}

export function buildPingMsg(): Buffer | null {
  const pingData = encodePb(PING_REQ, {})
  if (pingData == null) return null
  return encodeConnMsg(
    {
      cmdType: CMD_TYPE_REQUEST,
      cmd: CMD_PING,
      seqNo: nextSeq(),
      msgId: generateMsgId(),
      module: MODULE_CONN_ACCESS,
    },
    pingData,
  )
}

export function buildPushAck(originalHead: ConnHead): Buffer | null {
  return encodeConnMsg(
    {
      cmdType: CMD_TYPE_PUSH_ACK,
      cmd: originalHead.cmd,
      seqNo: nextSeq(),
      msgId: originalHead.msgId,
      module: originalHead.module,
    },
    null,
  )
}

function toProtoMsgBody(
  elements: Array<{ msg_type?: string; msg_content?: Record<string, unknown> }>,
): Array<Record<string, unknown>> {
  return elements.map((elem) => {
    const content = elem.msg_content ?? {}
    const protoContent: Record<string, unknown> = {}
    if (content.text != null) protoContent.text = content.text
    if (content.uuid != null) protoContent.uuid = content.uuid
    if (content.image_format != null) protoContent.imageFormat = content.image_format
    if (content.url != null) protoContent.url = content.url
    if (content.file_name != null) protoContent.fileName = content.file_name
    if (content.file_size != null) protoContent.fileSize = content.file_size
    if (content.desc != null) protoContent.desc = content.desc
    if (content.data != null) protoContent.data = content.data
    if (content.image_info_array != null) protoContent.imageInfoArray = content.image_info_array
    return {
      msgType: elem.msg_type ?? 'TIMTextElem',
      msgContent: protoContent,
    }
  })
}

function fromProtoMsgBody(
  elements: unknown,
): Array<{ msg_type: string; msg_content: Record<string, unknown> }> {
  if (!Array.isArray(elements)) return []
  return elements.map((elem) => {
    const e = elem as { msgType?: string; msgContent?: Record<string, unknown> }
    const mc = e.msgContent ?? {}
    const content: Record<string, unknown> = {}
    if (mc.text) content.text = mc.text
    if (mc.uuid) content.uuid = mc.uuid
    if (mc.imageFormat != null) content.image_format = mc.imageFormat
    if (mc.url) content.url = mc.url
    if (mc.fileName) content.file_name = mc.fileName
    if (mc.fileSize != null) content.file_size = mc.fileSize
    if (mc.desc) content.desc = mc.desc
    if (mc.data) content.data = mc.data
    if (mc.imageInfoArray) content.image_info_array = mc.imageInfoArray
    return { msg_type: String(e.msgType ?? ''), msg_content: content }
  })
}

export function buildSendC2cMsg(opts: {
  toAccount: string
  msgBody: Array<{ msg_type?: string; msg_content?: Record<string, unknown> }>
  fromAccount?: string
  groupCode?: string
}): { raw: Buffer; msgId: string } | null {
  const payload: Record<string, unknown> = {
    toAccount: opts.toAccount,
    fromAccount: opts.fromAccount ?? '',
    msgRandom: randomInt(0, 0xffffffff),
    msgBody: toProtoMsgBody(opts.msgBody),
  }
  if (opts.groupCode) payload.groupCode = opts.groupCode
  const bizData = encodePb(SEND_C2C_REQ, payload)
  if (!bizData) return null
  const msgId = generateMsgId()
  const raw = encodeConnMsg(
    {
      cmdType: CMD_TYPE_REQUEST,
      cmd: BIZ_CMD_SEND_C2C,
      seqNo: nextSeq(),
      msgId,
      module: MODULE_BIZ,
    },
    bizData,
  )
  if (!raw) return null
  return { raw, msgId }
}

export function buildSendGroupMsg(opts: {
  groupCode: string
  msgBody: Array<{ msg_type?: string; msg_content?: Record<string, unknown> }>
  fromAccount?: string
}): { raw: Buffer; msgId: string } | null {
  const payload: Record<string, unknown> = {
    groupCode: opts.groupCode,
    fromAccount: opts.fromAccount ?? '',
    random: String(randomInt(0, 0xffffffff)),
    msgBody: toProtoMsgBody(opts.msgBody),
  }
  const bizData = encodePb(SEND_GROUP_REQ, payload)
  if (!bizData) return null
  const msgId = generateMsgId()
  const raw = encodeConnMsg(
    {
      cmdType: CMD_TYPE_REQUEST,
      cmd: BIZ_CMD_SEND_GROUP,
      seqNo: nextSeq(),
      msgId,
      module: MODULE_BIZ,
    },
    bizData,
  )
  if (!raw) return null
  return { raw, msgId }
}

export function buildHeartbeatMsg(opts: {
  fromAccount: string
  toAccount: string
  heartbeat: number
  groupCode?: string
  sendTime?: number
}): { raw: Buffer; msgId: string } | null {
  let bizData: Buffer | null
  let cmd: string
  if (opts.groupCode) {
    bizData = encodePb(SEND_GROUP_HB_REQ, {
      fromAccount: opts.fromAccount,
      toAccount: opts.toAccount,
      groupCode: opts.groupCode,
      sendTime: opts.sendTime ?? 0,
      heartbeat: opts.heartbeat,
    })
    cmd = BIZ_CMD_GROUP_HB
  } else {
    bizData = encodePb(SEND_PRIVATE_HB_REQ, {
      fromAccount: opts.fromAccount,
      toAccount: opts.toAccount,
      heartbeat: opts.heartbeat,
    })
    cmd = BIZ_CMD_PRIVATE_HB
  }
  if (!bizData) return null
  const msgId = generateMsgId()
  const raw = encodeConnMsg(
    {
      cmdType: CMD_TYPE_REQUEST,
      cmd,
      seqNo: nextSeq(),
      msgId,
      module: MODULE_BIZ,
    },
    bizData,
  )
  if (!raw) return null
  return { raw, msgId }
}

export function decodeAuthBindRsp(data: Buffer): Record<string, unknown> | null {
  return decodePb(AUTH_BIND_RSP, data)
}

export function decodePingRsp(data: Buffer): Record<string, unknown> | null {
  return decodePb(PING_RSP, data)
}

export function decodeKickoutMsg(data: Buffer): Record<string, unknown> | null {
  return decodePb(KICKOUT_MSG, data)
}

export function decodeInboundMessage(data: Buffer): InboundYuanbaoMessage | null {
  const decoded = decodePb(INBOUND_MSG_PUSH, data)
  if (!decoded) return null
  return {
    callback_command: String(decoded.callbackCommand ?? ''),
    from_account: String(decoded.fromAccount ?? ''),
    to_account: String(decoded.toAccount ?? ''),
    sender_nickname: String(decoded.senderNickname ?? ''),
    group_code: String(decoded.groupCode ?? ''),
    group_name: String(decoded.groupName ?? ''),
    msg_seq: Number(decoded.msgSeq ?? 0),
    msg_time: Number(decoded.msgTime ?? 0),
    msg_key: String(decoded.msgKey ?? ''),
    msg_id: String(decoded.msgId ?? ''),
    msg_body: fromProtoMsgBody(decoded.msgBody),
    bot_owner_id: String(decoded.botOwnerId ?? ''),
    claw_msg_type: Number(decoded.clawMsgType ?? 0),
  }
}

export function decodeSendRsp(data: Buffer): Record<string, unknown> | null {
  return decodePb(SEND_C2C_RSP, data) ?? decodePb(SEND_GROUP_RSP, data)
}

/** Extract plain text from inbound msg_body elements. */
export function extractTextFromMsgBody(
  body: Array<{ msg_type: string; msg_content: Record<string, unknown> }>,
): string {
  const parts: string[] = []
  for (const el of body) {
    const t = el.msg_content?.text
    if (typeof t === 'string' && t) parts.push(t)
  }
  return parts.join('\n').trim()
}



export type YuanbaoInboundAttachment = {
  type: 'image' | 'file' | 'audio'
  url: string
  name?: string
  mimeType?: string
  size?: number
  width?: number
  height?: number
}

const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.m4a', '.ogg', '.opus', '.silk', '.amr', '.aac', '.flac',
])

function classifyFilename(name: string): 'audio' | 'file' {
  const i = name.lastIndexOf('.')
  const ext = i >= 0 ? name.slice(i).toLowerCase() : ''
  return AUDIO_EXTS.has(ext) ? 'audio' : 'file'
}

/** Extract image/file/audio attachments from inbound msg_body (QwenPaw _parse_msg_body). */
export function extractAttachmentsFromMsgBody(
  body: Array<{ msg_type: string; msg_content: Record<string, unknown> }>,
): YuanbaoInboundAttachment[] {
  const out: YuanbaoInboundAttachment[] = []
  for (const el of body) {
    const content = el.msg_content ?? {}
    if (el.msg_type === 'TIMImageElem') {
      let imageUrl = ''
      const arr = content.image_info_array
      if (Array.isArray(arr)) {
        for (const info of arr) {
          if (info && typeof info === 'object' && typeof (info as { url?: string }).url === 'string') {
            imageUrl = (info as { url: string }).url
            break
          }
        }
      }
      if (!imageUrl && typeof content.url === 'string') imageUrl = content.url
      if (imageUrl) {
        const first = Array.isArray(arr) && arr[0] && typeof arr[0] === 'object' ? (arr[0] as Record<string, unknown>) : {}
        out.push({
          type: 'image',
          url: imageUrl,
          name: 'image.jpg',
          mimeType: 'image/jpeg',
          size: typeof first.size === 'number' ? first.size : undefined,
          width: typeof first.width === 'number' ? first.width : undefined,
          height: typeof first.height === 'number' ? first.height : undefined,
        })
      }
    } else if (el.msg_type === 'TIMFileElem') {
      const fileUrl = typeof content.url === 'string' ? content.url : ''
      const filename = (typeof content.file_name === 'string' && content.file_name) || 'file'
      if (fileUrl) {
        const kind = classifyFilename(filename)
        out.push({
          type: kind,
          url: fileUrl,
          name: filename,
          size: typeof content.file_size === 'number' ? content.file_size : undefined,
        })
      }
    }
  }
  return out
}

/** Reset module state (tests). */
export function resetCodecForTests(): void {
  root = null
  seqCounter = 0
}
