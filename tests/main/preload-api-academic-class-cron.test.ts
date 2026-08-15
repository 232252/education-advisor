// =============================================================
// Preload API — Academic / Class / Cron / Ollama / MCP 域测试
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
import { academicApi } from '../../src/main/preload/api/academic'
import { classApi } from '../../src/main/preload/api/class'
import { cronApi } from '../../src/main/preload/api/cron'
import { ollamaApi } from '../../src/main/preload/api/ollama'
import { mcpApi } from '../../src/main/preload/api/mcp'

describe('academicApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('getConfig / listExams(可选学期)', () => {
    void academicApi.getConfig()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_GET_CONFIG)
    void academicApi.listExams('2025-2026-2')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_LIST_EXAMS, '2025-2026-2')
  })

  it('createExam / deleteExam', () => {
    const exam = { name: '期中', type: 'midterm', date: '2026-03-01' }
    void academicApi.createExam(exam)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_CREATE_EXAM, exam)
    void academicApi.deleteExam('exam-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_DELETE_EXAM, 'exam-1')
  })

  it('getGrades / batchSetGrades / getClassGrades', () => {
    void academicApi.getGrades('小明')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_GET_GRADES, '小明')

    const records = [{ examId: 'e1', studentName: '小明', subjectId: 'math', score: 100 }]
    void academicApi.batchSetGrades(records)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_BATCH_SET_GRADES, records)

    void academicApi.getClassGrades(['小明', '小红'], 'e1', 'math')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_ACADEMIC_GET_CLASS_GRADES, ['小明', '小红'], 'e1', 'math')
  })
})

describe('classApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('list / create / update / archive / restore / delete', () => {
    void classApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_LIST)

    const params = { class_id: 'G7-1', name: '一班' }
    void classApi.create(params)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_CREATE, params)

    void classApi.update('uuid-1', { name: '改名' })
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_UPDATE, 'uuid-1', { name: '改名' })

    void classApi.archive('uuid-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_ARCHIVE, 'uuid-1')
    void classApi.restore('uuid-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_RESTORE, 'uuid-1')
    void classApi.delete('uuid-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_DELETE, 'uuid-1')
  })

  it('assign: 批量调班参数透传', () => {
    const params = { classId: 'G7-1', students: ['小明'] }
    void classApi.assign(params)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CLASS_ASSIGN, params)
  })

  it('onAssignProgress: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = classApi.onAssignProgress(cb)

    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_CLASS_ASSIGN_PROGRESS)
    handler({}, { current: 2, total: 5, lastName: '小明' })
    expect(cb).toHaveBeenCalledWith({ current: 2, total: 5, lastName: '小明' })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_CLASS_ASSIGN_PROGRESS, handler)
  })
})

describe('cronApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('list / add / update / remove / toggle / runNow', () => {
    void cronApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_LIST)

    const task = { id: 't1', cron: '0 8 * * *' }
    void cronApi.add(task)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_ADD, task)

    void cronApi.update('t1', { enabled: false })
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_UPDATE, 't1', { enabled: false })

    void cronApi.remove('t1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_REMOVE, 't1')

    void cronApi.toggle('t1', true)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_TOGGLE, 't1', true)

    void cronApi.runNow('t1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_RUN_NOW, 't1')
  })

  it('getLogs: 透传可选 taskId', () => {
    void cronApi.getLogs('t1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_CRON_GET_LOGS, 't1')
    void cronApi.getLogs()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.IPC_CRON_GET_LOGS, undefined)
  })

  it('onStatusUpdate: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = cronApi.onStatusUpdate(cb)

    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_CRON_STATUS_UPDATE)
    handler({}, { taskId: 't1', running: true })
    expect(cb).toHaveBeenCalledWith({ taskId: 't1', running: true })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_CRON_STATUS_UPDATE, handler)
  })
})

describe('ollamaApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('detect / startServe / stopServe / listModels', () => {
    void ollamaApi.detect()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_DETECT)
    void ollamaApi.startServe()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_START_SERVE)
    void ollamaApi.stopServe()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_STOP_SERVE)
    void ollamaApi.listModels()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_LIST_MODELS)
  })

  it('pullModel / deleteModel: 透传模型名', () => {
    void ollamaApi.pullModel('qwen3:4b')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_PULL_MODEL, 'qwen3:4b')
    void ollamaApi.deleteModel('qwen3:4b')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_OLLAMA_DELETE_MODEL, 'qwen3:4b')
  })

  it('onPullProgress: 订阅/回调/取消订阅', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = ollamaApi.onPullProgress(cb)

    const [channel, handler] = mocks.on.mock.calls[0]
    expect(channel).toBe(IPC.IPC_OLLAMA_PULL_PROGRESS)
    handler({}, { percent: 42 })
    expect(cb).toHaveBeenCalledWith({ percent: 42 })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_OLLAMA_PULL_PROGRESS, handler)
  })
})

describe('mcpApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('list / connect / disconnect / listTools / test', () => {
    void mcpApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_LIST)
    void mcpApi.connect('srv-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_CONNECT, 'srv-1')
    void mcpApi.disconnect('srv-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_DISCONNECT, 'srv-1')
    void mcpApi.listTools('srv-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_LIST_TOOLS, 'srv-1')
    void mcpApi.test('srv-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_TEST, 'srv-1')
  })

  it('add / update / remove', () => {
    const config = { id: 'srv-1', command: 'npx' }
    void mcpApi.add(config)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_ADD, config)

    void mcpApi.update('srv-1', { command: 'node' })
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_UPDATE, 'srv-1', { command: 'node' })

    void mcpApi.remove('srv-1')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_MCP_REMOVE, 'srv-1')
  })
})