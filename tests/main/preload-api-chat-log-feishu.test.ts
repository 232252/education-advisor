// =============================================================
// Preload API — Chat / Log / Feishu 域测试
// log.forward 使用 ipcRenderer.send(单向通知)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mocks.invoke,
    send: mocks.send,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}))

import * as IPC from '../../src/shared/ipc-channels'
import { chatApi } from '../../src/main/preload/api/chat'
import { logApi } from '../../src/main/preload/api/log'
import { feishuApi } from '../../src/main/preload/api/feishu'

describe('chatApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('saveMessage: 透传完整消息对象', () => {
    const msg = {
      sessionId: 's1',
      role: 'user',
      content: '你好',
      timestamp: 1767225600000,
      model: 'gpt-4o',
    }
    void chatApi.saveMessage(msg)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CHAT_SAVE_MESSAGE, msg)
  })

  it('loadMessages: 透传可选 sessionId', () => {
    void chatApi.loadMessages('s1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CHAT_LOAD_MESSAGES, 's1')
    void chatApi.loadMessages()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.IPC_CHAT_LOAD_MESSAGES, undefined)
  })

  it('deleteSession / listSessions', () => {
    void chatApi.deleteSession('s1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CHAT_DELETE_SESSION, 's1')
    void chatApi.listSessions()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CHAT_LIST_SESSIONS)
  })
})

describe('logApi — invoke/send 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.send.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('list / clear', () => {
    void logApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_LIST)
    void logApi.clear()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_CLEAR)
  })

  it('read: 透传 name 与可选行数', () => {
    void logApi.read('main-2026-08-15.log', 50)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_READ, 'main-2026-08-15.log', 50)
    void logApi.read('main-2026-08-15.log')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.IPC_LOG_READ, 'main-2026-08-15.log', undefined)
  })

  it('filter / search: 透传过滤参数', () => {
    void logApi.filter('main-2026-08-15.log', ['warn', 'error'], 30)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_FILTER, 'main-2026-08-15.log', ['warn', 'error'], 30)

    void logApi.search('main-2026-08-15.log', 'timeout', 10)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_SEARCH, 'main-2026-08-15.log', 'timeout', 10)
  })

  it('exportWithDialog: 透传文件名', () => {
    void logApi.exportWithDialog('main-2026-08-15.log')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_LOG_EXPORT_DIALOG, 'main-2026-08-15.log')
  })

  it('forward: 使用 ipcRenderer.send(单向通知)', () => {
    logApi.forward('warn', 'renderer warning')
    expect(mocks.send).toHaveBeenCalledWith(IPC.IPC_LOG_WRITE_RENDERER, 'warn', 'renderer warning')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('feishuApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('test / listBitable / status', () => {
    void feishuApi.test('cli_xxx')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_TEST, 'cli_xxx')

    void feishuApi.listBitable('cli_xxx', 'appToken123')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_BITABLE, 'cli_xxx', 'appToken123')

    void feishuApi.status()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_STATUS)
  })

  it('botStart / botStop / botStatus / diagnose', () => {
    void feishuApi.botStart()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_BOT_START)
    void feishuApi.botStop()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_BOT_STOP)
    void feishuApi.botStatus()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_BOT_STATUS)
    void feishuApi.diagnose()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_FEISHU_DIAGNOSE)
  })

  it('onBotStatusUpdate: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = feishuApi.onBotStatusUpdate(cb)

    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_FEISHU_BOT_STATUS_UPDATE)
    handler({}, { connected: true })
    expect(cb).toHaveBeenCalledWith({ connected: true })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_FEISHU_BOT_STATUS_UPDATE, handler)
  })
})