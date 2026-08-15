// =============================================================
// Preload API — Agent / AI 域测试
// mock electron ipcRenderer(invoke/on/removeListener)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}))

import * as IPC from '../../src/shared/ipc-channels'
import { agentApi } from '../../src/main/preload/api/agent'
import { aiApi } from '../../src/main/preload/api/ai'

describe('agentApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('list: agent:list', () => {
    void agentApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_LIST)
  })

  it('get: 透传 id', () => {
    void agentApi.get('weekly-report')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_GET, 'weekly-report')
  })

  it('toggle: 透传 id + enabled', () => {
    void agentApi.toggle('daily-sync', true)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_TOGGLE, 'daily-sync', true)
  })

  it('update: 透传 id + patch', () => {
    const patch = { enabled: false }
    void agentApi.update('daily-sync', patch)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_UPDATE, 'daily-sync', patch)
  })

  it('setSoul / setRules: 透传内容', () => {
    void agentApi.setSoul('id-1', '# SOUL')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_SET_SOUL, 'id-1', '# SOUL')
    void agentApi.setRules('id-1', '# RULES')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_SET_RULES, 'id-1', '# RULES')
  })

  it('runManual: 透传 id/prompt/history', () => {
    const history = [{ role: 'user', content: 'hi' }]
    void agentApi.runManual('id-1', '执行任务', history)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_RUN_MANUAL, 'id-1', '执行任务', history)
    void agentApi.runManual('id-1', '执行任务')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.IPC_AGENT_RUN_MANUAL, 'id-1', '执行任务', undefined)
  })

  it('getHistory / abort', () => {
    void agentApi.getHistory('id-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_GET_HISTORY, 'id-1')
    void agentApi.abort('id-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AGENT_ABORT, 'id-1')
  })

  it('onStatusUpdate: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = agentApi.onStatusUpdate(cb)

    expect(mocks.on).toHaveBeenCalledTimes(1)
    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_AGENT_STATUS_UPDATE)
    expect(typeof handler).toBe('function')

    // 模拟主进程推送: handler(_e, data) → cb(data)
    handler({}, { status: 'running', agentId: 'id-1' })
    expect(cb).toHaveBeenCalledWith({ status: 'running', agentId: 'id-1' })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_AGENT_STATUS_UPDATE, handler)
  })
})

describe('aiApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('listProviders / listModels', () => {
    void aiApi.listProviders()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_LIST_PROVIDERS)
    void aiApi.listModels('openai')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_LIST_MODELS, 'openai')
  })

  it('testConnection: 透传 providerId/apiKey/baseUrl', () => {
    void aiApi.testConnection('openai', 'sk-x', 'https://api.example.com')
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.IPC_AI_TEST_CONNECTION,
      'openai',
      'sk-x',
      'https://api.example.com',
    )
  })

  it('setApiKey / deleteApiKey / oauthLogin', () => {
    void aiApi.setApiKey('openai', 'sk-x')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_SET_API_KEY, 'openai', 'sk-x')
    void aiApi.deleteApiKey('openai')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_DELETE_API_KEY, 'openai')
    void aiApi.oauthLogin('anthropic')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_OAUTH_LOGIN, 'anthropic')
  })

  it('chat: 透传完整参数对象', () => {
    const params = {
      providerId: 'openai',
      modelId: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    }
    void aiApi.chat(params)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_CHAT, params)
  })

  it('addCustomModel / updateCustomModel / deleteCustomModel', () => {
    const add = { providerId: 'openai', modelId: 'm1' }
    void aiApi.addCustomModel(add)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_ADD_CUSTOM_MODEL, add)

    const upd = { providerId: 'openai', modelId: 'm1', name: 'M1' }
    void aiApi.updateCustomModel(upd)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_UPDATE_CUSTOM_MODEL, upd)

    void aiApi.deleteCustomModel('openai', 'm1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_AI_DEL_CUSTOM_MODEL, 'openai', 'm1')
  })

  it('onStream: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = aiApi.onStream(cb)

    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_AI_CHAT_STREAM)

    const evt = { type: 'delta', text: 'hello' }
    handler({}, evt)
    expect(cb).toHaveBeenCalledWith(evt)

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_AI_CHAT_STREAM, handler)
  })
})