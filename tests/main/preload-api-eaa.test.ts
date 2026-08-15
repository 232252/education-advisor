// =============================================================
// Preload API — EAA 域测试
// mock electron ipcRenderer,断言每个函数的 channel 与参数透传
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mocks.invoke,
  },
}))

import * as IPC from '../../src/shared/ipc-channels'
import { eaaApi } from '../../src/main/preload/api/eaa'

describe('eaaApi — invoke 通道与参数', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
  })

  it('info: 调用 eaa:info 无参数', () => {
    void eaaApi.info()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_INFO)
  })

  it('score: 透传学生名', () => {
    void eaaApi.score('小明')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_SCORE, '小明')
  })

  it('ranking: 透传可选条数', () => {
    void eaaApi.ranking()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_RANKING, undefined)
    void eaaApi.ranking(10)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_RANKING, 10)
  })

  it('replay: 调用 eaa:replay', () => {
    void eaaApi.replay()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_REPLAY)
  })

  it('addEvent: 透传参数对象', () => {
    const params = { name: '小明', type: 'praise' }
    void eaaApi.addEvent(params)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_ADD_EVENT, params)
  })

  it('revertEvent: 透传 eventId 与 reason', () => {
    void eaaApi.revertEvent('evt-1', '误操作')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_REVERT_EVENT, 'evt-1', '误操作')
  })

  it('history: 透传学生名', () => {
    void eaaApi.history('小红')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_HISTORY, '小红')
  })

  it('search: 透传 query 与可选 limit', () => {
    void eaaApi.search('迟到', 5)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_SEARCH, '迟到', 5)
  })

  it('range: 透传 start/end/limit', () => {
    void eaaApi.range('2026-01-01', '2026-02-01', 50)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_RANGE, '2026-01-01', '2026-02-01', 50)
  })

  it('tag: 透传可选 tag', () => {
    void eaaApi.tag('homework')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_TAG, 'homework')
  })

  it('stats / validate / codes / doctor: 无参数调用', () => {
    void eaaApi.stats()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_STATS)
    void eaaApi.validate()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_VALIDATE)
    void eaaApi.codes()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_CODES)
    void eaaApi.doctor()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_DOCTOR)
  })

  it('export: 透传 format 与可选 outputFile', () => {
    void eaaApi.export('csv')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_EXPORT, 'csv', undefined)
    void eaaApi.export('json', 'C:/out.json')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_EXPORT, 'json', 'C:/out.json')
  })

  it('listStudents / addStudent: 学生列表与新增', () => {
    void eaaApi.listStudents()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_LIST_STUDENTS)
    void eaaApi.addStudent('新同学')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_ADD_STUDENT, '新同学')
  })

  it('deleteStudent: 自动附带 { confirm: true, reason }', () => {
    void eaaApi.deleteStudent('小明', '毕业')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_DELETE_STUDENT, '小明', {
      confirm: true,
      reason: '毕业',
    })
    void eaaApi.deleteStudent('小明')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.IPC_EAA_DELETE_STUDENT, '小明', {
      confirm: true,
      reason: undefined,
    })
  })

  it('setStudentMeta / import: 元数据与导入', () => {
    const params = { name: '小明', classId: 'G7-1' }
    void eaaApi.setStudentMeta(params)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_SET_STUDENT_META, params)
    void eaaApi.import('C:/data.json')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_IMPORT, 'C:/data.json')
  })

  it('summary: 透传可选时间范围', () => {
    void eaaApi.summary('2026-01-01', '2026-06-30')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_SUMMARY, '2026-01-01', '2026-06-30')
  })

  it('dashboard / exportFormats / invalidateCache', () => {
    void eaaApi.dashboard('C:/out')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_DASHBOARD, 'C:/out')
    void eaaApi.exportFormats()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_EXPORT_FORMATS)
    void eaaApi.invalidateCache()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_EAA_INVALIDATE_CACHE)
  })

  it('invoke 返回值透传给调用方', async () => {
    mocks.invoke.mockResolvedValueOnce({ ok: true, data: [1, 2] })
    const r = await eaaApi.score('小明')
    expect(r).toEqual({ ok: true, data: [1, 2] })
  })
})