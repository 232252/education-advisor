// =============================================================
// 钉钉 AI 卡片回复会话 — 用注入假 fetch 的真实 DingtalkApiClient
// 锚定请求形状与生命周期:
//   创建+投放+INPUTING 占位 / streaming 全量帧 / finalize 终帧+FINISHED /
//   fail → FAILED / 卡片链路失败降级 sessionWebhook 纯文本 / 节流合帧
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import { DingtalkApiClient } from '../../../src/main/services/channels/adapters/dingtalk/api'
import {
  DEFAULT_AI_CARD_TEMPLATE_ID,
  AI_CARD_STATUS,
} from '../../../src/main/services/channels/adapters/dingtalk/constants'
import type { DingtalkDeliveryInfo } from '../../../src/main/services/channels/adapters/dingtalk/parsing'
import { createDingtalkReplySession } from '../../../src/main/services/channels/adapters/dingtalk/reply-session'

interface RecordedRequest {
  method: string
  url: string
  body: Record<string, unknown>
}

function makeApi(requests: RecordedRequest[], failCardCreate = false): DingtalkApiClient {
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    })
    if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ accessToken: 'tok-1', expireIn: 7200 }),
        text: async () => JSON.stringify({ accessToken: 'tok-1', expireIn: 7200 }),
      } as unknown as Response
    }
    if (failCardCreate && String(url).endsWith('/v1.0/card/instances') && init?.method === 'POST') {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ code: 'Forbidden.Access', message: 'no card permission' }),
      } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response
  }
  return new DingtalkApiClient({ clientId: 'robot-1', clientSecret: 'cs', fetchImpl })
}

const DELIVERY_P2P: DingtalkDeliveryInfo = {
  sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
  conversationType: '1',
  conversationId: 'cid-1',
  senderStaffId: 'staff-1',
  senderNick: '张老师',
}

const DELIVERY_GROUP: DingtalkDeliveryInfo = {
  ...DELIVERY_P2P,
  conversationType: '2',
  conversationId: 'cid-group',
}

describe('createDingtalkReplySession(卡片链路)', () => {
  let requests: RecordedRequest[]
  let api: DingtalkApiClient

  beforeEach(() => {
    vi.useFakeTimers()
    requests = []
    api = makeApi(requests)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('创建会话: 公共模板 + STREAM 回调 + 投放到单聊 + INPUTING 占位', async () => {
    await createDingtalkReplySession({ api, delivery: DELIVERY_P2P }, '正在思考…')
    // 顺序: token → create card → deliver → INPUTING 状态
    const create = requests.find(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'POST',
    )
    expect(create?.body).toMatchObject({
      cardTemplateId: DEFAULT_AI_CARD_TEMPLATE_ID,
      callbackType: 'STREAM',
    })
    const deliver = requests.find((r) => r.url.endsWith('/v1.0/card/instances/deliver'))
    expect(deliver?.body).toMatchObject({
      openSpaceId: 'dtv1.card//IM_ROBOT.staff-1',
      imRobotOpenDeliverModel: { robotCode: 'robot-1' },
    })
    const inputing = requests.filter(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'PUT',
    )
    expect(
      (inputing[0]?.body as { cardData?: { cardParamMap?: Record<string, string> } })
        ?.cardData?.cardParamMap?.flowStatus,
    ).toBe(AI_CARD_STATUS.INPUTING)
  })

  it('群聊投放目标 = IM_GROUP.<conversationId>', async () => {
    await createDingtalkReplySession({ api, delivery: DELIVERY_GROUP }, '正在思考…')
    const deliver = requests.find((r) => r.url.endsWith('/v1.0/card/instances/deliver'))
    expect(deliver?.body).toMatchObject({
      openSpaceId: 'dtv1.card//IM_GROUP.cid-group',
      imGroupOpenDeliverModel: { robotCode: 'robot-1' },
    })
  })

  it('update 节流合帧 → streaming 全量帧(isFull=true, isFinalize=false)', async () => {
    const session = await createDingtalkReplySession({ api, delivery: DELIVERY_P2P }, '占位')
    requests.length = 0
    await session.update('第一段')
    await session.update('第一段第二段')
    await session.update('第一段第二段第三段')
    // 节流窗口内合并,900ms 后只发最新全量
    await vi.advanceTimersByTimeAsync(1000)
    const frames = requests.filter((r) => r.url.endsWith('/v1.0/card/streaming'))
    expect(frames).toHaveLength(1)
    expect(frames[0].body).toMatchObject({
      key: 'msgContent',
      content: '第一段第二段第三段',
      isFull: true,
      isFinalize: false,
    })
  })

  it('finalize: 终帧(isFinalize=true) + FINISHED 状态(双请求)', async () => {
    const session = await createDingtalkReplySession({ api, delivery: DELIVERY_P2P }, '占位')
    requests.length = 0
    await session.finalize('最终答案\n- 结论一')
    const frames = requests.filter((r) => r.url.endsWith('/v1.0/card/streaming'))
    expect(frames).toHaveLength(1)
    expect(frames[0].body).toMatchObject({ isFinalize: true, content: expect.stringContaining('最终答案') })
    const puts = requests.filter(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'PUT',
    )
    const paramMap = (puts[puts.length - 1].body as { cardData: { cardParamMap: Record<string, string> } })
      .cardData.cardParamMap
    expect(paramMap.flowStatus).toBe(AI_CARD_STATUS.FINISHED)
    // finalize 幂等: 再次调用不再发请求
    requests.length = 0
    await session.finalize('again')
    await session.fail('err')
    expect(requests).toHaveLength(0)
  })

  it('fail: FAILED 状态携带错误文案,幂等', async () => {
    const session = await createDingtalkReplySession({ api, delivery: DELIVERY_P2P }, '占位')
    requests.length = 0
    await session.fail('出错了')
    const puts = requests.filter(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'PUT',
    )
    const paramMap = (puts[0].body as { cardData: { cardParamMap: Record<string, string> } })
      .cardData.cardParamMap
    expect(paramMap.flowStatus).toBe(AI_CARD_STATUS.FAILED)
    expect(paramMap.msgContent).toContain('出错了')
    requests.length = 0
    await session.fail('再次')
    expect(requests).toHaveLength(0)
  })

  it('自定义模板 ID 覆盖公共模板', async () => {
    await createDingtalkReplySession(
      { api, delivery: DELIVERY_P2P, cardTemplateId: 'custom-tpl.schema' },
      '占位',
    )
    const create = requests.find(
      (r) => r.url.endsWith('/v1.0/card/instances') && r.method === 'POST',
    )
    expect(create?.body).toMatchObject({ cardTemplateId: 'custom-tpl.schema' })
  })
})

describe('createDingtalkReplySession(降级链)', () => {
  it('卡片创建失败(无权限) → 降级 sessionWebhook 纯文本,finalize 一次性发送', async () => {
    vi.useFakeTimers()
    const requests: RecordedRequest[] = []
    const api = makeApi(requests, true)
    const session = await createDingtalkReplySession({ api, delivery: DELIVERY_P2P }, '正在思考…')
    await session.update('中间内容') // no-op
    await session.finalize('最终结果')
    const webhook = requests.find((r) => r.url.includes('sendBySession'))
    expect(webhook).toBeDefined()
    expect(webhook?.body).toMatchObject({ msgtype: 'text', text: { content: '最终结果' } })
    // 单聊降级不带 @
    expect(webhook?.body).not.toHaveProperty('at')
    vi.useRealTimers()
  })

  it('群聊降级回执 @发送者', async () => {
    vi.useFakeTimers()
    const requests: RecordedRequest[] = []
    const api = makeApi(requests, true)
    const session = await createDingtalkReplySession({ api, delivery: DELIVERY_GROUP }, '占位')
    await session.fail('失败了')
    const webhook = requests.find((r) => r.url.includes('sendBySession'))
    expect(webhook?.body).toMatchObject({ at: { atUserIds: ['staff-1'] } })
    vi.useRealTimers()
  })
})

describe('DingtalkApiClient(API 形状)', () => {
  it('accessToken 缓存(两次 API 调用只取一次 token)', async () => {
    const requests: RecordedRequest[] = []
    const api = makeApi(requests)
    const t1 = await api.getAccessToken()
    const t2 = await api.getAccessToken()
    expect(t1).toBe(t2)
    expect(requests.filter((r) => r.url.endsWith('/v1.0/oauth2/accessToken'))).toHaveLength(1)
  })

  it('validateCredentials: 401 → 可读凭证错误', async () => {
    const fetchImpl = async (): Promise<Response> =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ code: 'invalidClientSecret', message: 'bad secret' }),
      }) as unknown as Response
    const api = new DingtalkApiClient({ clientId: 'x', clientSecret: 'y', fetchImpl })
    expect(await api.validateCredentials()).toMatch(/不正确/)
  })

  it('文件下载两跳: downloadCode → downloadUrl → GET 落盘', async () => {
    const tmpDir = await import('node:fs/promises').then((fsp) =>
      fsp.mkdtemp('dt-test-attachments-'),
    )
    const requests: RecordedRequest[] = []
    const fileBytes = new TextEncoder().encode('hello,dingtalk')
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      requests.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      })
      if (String(url).endsWith('/v1.0/oauth2/accessToken')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: 'tok-1', expireIn: 7200 }),
          text: async () => JSON.stringify({ accessToken: 'tok-1', expireIn: 7200 }),
        } as unknown as Response
      }
      if (String(url).endsWith('/v1.0/robot/messageFiles/download')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ downloadUrl: 'https://dl.dingtalk.com/tmp/file.bin' }),
          text: async () => JSON.stringify({ downloadUrl: 'https://dl.dingtalk.com/tmp/file.bin' }),
        } as unknown as Response
      }
      if (String(url).includes('dl.dingtalk.com')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fileBytes.buffer,
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response
    }
    const api = new DingtalkApiClient({ clientId: 'r', clientSecret: 's', fetchImpl })
    const r = await api.downloadAttachment({
      downloadCode: 'dc-1',
      fileName: '成绩单.xlsx',
      kind: 'file',
      dir: tmpDir,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.saved.bytes).toBe(fileBytes.byteLength)
      expect(r.saved.name).toBe('成绩单.xlsx')
    }
    const post = requests.find((r2) => r2.url.endsWith('/v1.0/robot/messageFiles/download'))
    expect(post?.body).toMatchObject({ robotCode: 'r', downloadCode: 'dc-1' })
    const get = requests.find((r2) => r2.url.includes('dl.dingtalk.com'))
    expect(get?.method).toBe('GET')
  })

  it('主动单聊推送: batchSend 形状', async () => {
    const requests: RecordedRequest[] = []
    const api = makeApi(requests)
    await api.pushOtoMessage('staff-9', '通知内容')
    const req = requests.find((r) => r.url.endsWith('/v1.0/robot/oToMessages/batchSend'))
    expect(req?.body).toMatchObject({
      msgKey: 'sampleText',
      robotCode: 'robot-1',
      userIds: ['staff-9'],
      msgParam: JSON.stringify({ content: '通知内容' }),
    })
  })
})
