// =============================================================
// useGradingData — 批改页数据 hook 的信封语义测试
// 覆盖: 初始加载成败、详情选择、runMutation 统一包装
// (成功→notice+刷新 / 失败→errorMsg+不刷新)、删除当前任务自动清
// 详情、publish/identify 的 notice 组装、abort 直通、clearFeedback。
// 防呆回归: publish 响应缺 skipped 字段不得抛 TypeError
// (IPC 跨进程边界,编译期类型不保证运行时形状)。
// =============================================================

import { act, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradingTask } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  importPapers: vi.fn(),
  assignPaper: vi.fn(),
  removePaper: vi.fn(),
  mergePapers: vi.fn(),
  setStatus: vi.fn(),
  run: vi.fn(),
  regrade: vi.fn(),
  identifyPapers: vi.fn(),
  abort: vi.fn(),
  saveReview: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    grading: {
      listTasks: mocks.listTasks,
      getTask: mocks.getTask,
      createTask: mocks.createTask,
      updateTask: mocks.updateTask,
      deleteTask: mocks.deleteTask,
      importPapers: mocks.importPapers,
      assignPaper: mocks.assignPaper,
      removePaper: mocks.removePaper,
      mergePapers: mocks.mergePapers,
      setStatus: mocks.setStatus,
      run: mocks.run,
      regrade: mocks.regrade,
      identifyPapers: mocks.identifyPapers,
      abort: mocks.abort,
      saveReview: mocks.saveReview,
      publish: mocks.publish,
    },
  }),
}))

import { useGradingData } from '../../../../src/renderer/pages/Grading/hooks/useGradingData'

/** 最小 GradingTask 形状(仅 hook 用到的 id 等字段;其余由调用方裁剪) */
function task(id: string, extra: Partial<GradingTask> = {}): GradingTask {
  return { id, ...extra } as GradingTask
}

const TASKS: GradingTask[] = [task('t1'), task('t2')]

describe('useGradingData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTasks.mockResolvedValue({ success: true, data: TASKS })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mount() {
    const h = renderHook(() => useGradingData())
    await waitFor(() => expect(h.result.current.loading).toBe(false))
    return h
  }

  it('初始加载成功: tasks 装载,loading 翻 false,无错误', async () => {
    const h = await mount()
    expect(h.result.current.tasks).toEqual(TASKS)
    expect(h.result.current.errorMsg).toBeNull()
  })

  it('初始加载失败: errorMsg 设置,页面不崩', async () => {
    mocks.listTasks.mockResolvedValue({ success: false, error: 'db locked' })
    const h = renderHook(() => useGradingData())
    await waitFor(() => expect(h.result.current.errorMsg).toBe('db locked'))
    expect(h.result.current.loading).toBe(false)
  })

  it('selectTask 拉取详情;selectTask(null) 清空详情', async () => {
    const h = await mount()
    mocks.getTask.mockResolvedValue({ success: true, data: task('t1') })
    await act(async () => {
      h.result.current.selectTask('t1')
    })
    await waitFor(() => expect(h.result.current.detail?.id).toBe('t1'))
    await act(async () => {
      h.result.current.selectTask(null)
    })
    expect(h.result.current.detail).toBeNull()
  })

  it('runMutation 失败: 返回 false,errorMsg 设置,列表不重复刷新', async () => {
    const h = await mount()
    expect(mocks.listTasks).toHaveBeenCalledTimes(1)
    mocks.createTask.mockResolvedValue({ success: false, error: '量规为空' })
    let ok = false
    await act(async () => {
      ok = await h.result.current.createTask({ name: 'x', semester: 's', rubric: [] })
    })
    expect(ok).toBe(false)
    expect(h.result.current.errorMsg).toBe('量规为空')
    expect(mocks.listTasks).toHaveBeenCalledTimes(1)
    expect(h.result.current.busy).toBe(false)
  })

  it('runMutation 成功: notice 设置,列表与详情都刷新,返回 true', async () => {
    const h = await mount()
    mocks.getTask.mockResolvedValue({ success: true, data: task('t1') })
    await act(async () => {
      h.result.current.selectTask('t1')
    })
    await waitFor(() => expect(h.result.current.detail?.id).toBe('t1'))
    mocks.setStatus.mockResolvedValue({ success: true })
    let ok = false
    await act(async () => {
      ok = await h.result.current.setStatus('t1', 'review')
    })
    expect(ok).toBe(true)
    expect(h.result.current.errorMsg).toBeNull()
    // 初始 1 次 + mutation 后 1 次
    expect(mocks.listTasks).toHaveBeenCalledTimes(2)
    expect(mocks.getTask).toHaveBeenCalledTimes(2)
  })

  it('删除当前选中的任务后详情自动清空', async () => {
    const h = await mount()
    mocks.getTask.mockResolvedValue({ success: true, data: task('t1') })
    await act(async () => {
      h.result.current.selectTask('t1')
    })
    await waitFor(() => expect(h.result.current.detail?.id).toBe('t1'))
    mocks.deleteTask.mockResolvedValue({ success: true })
    let ok = false
    await act(async () => {
      ok = await h.result.current.deleteTask('t1')
    })
    expect(ok).toBe(true)
    await waitFor(() => expect(h.result.current.detail).toBeNull())
  })

  it('publish 成功: notice 含发布数;有跳过时追加后缀', async () => {
    const h = await mount()
    mocks.publish.mockResolvedValue({
      success: true,
      data: { published: 3, skipped: [{ paperId: 'p9', studentName: null, reason: '未识别' }] },
    })
    await act(async () => {
      await h.result.current.publish('t1')
    })
    const notice = h.result.current.notice ?? ''
    expect(notice).toContain('3')
    expect(notice.length).toBeGreaterThan(0)
  })

  it('防呆回归: publish 响应缺 skipped 字段不得抛 TypeError', async () => {
    const h = await mount()
    // 契约要求 skipped 必填,但 IPC 跨进程边界不保证运行时形状
    mocks.publish.mockResolvedValue({ success: true, data: { published: 2 } })
    let ok = false
    await act(async () => {
      ok = await h.result.current.publish('t1')
    })
    expect(ok).toBe(true)
    expect(h.result.current.errorMsg).toBeNull()
  })

  it('identifyPapers 成功: notice 组装 assigned/unresolved 统计', async () => {
    const h = await mount()
    mocks.identifyPapers.mockResolvedValue({
      success: true,
      data: { assigned: 5, unresolved: 2, merged: 1, continuationMerged: 0, duplicates: [] },
    })
    let ok = false
    await act(async () => {
      ok = await h.result.current.identifyPapers('t1', [])
    })
    expect(ok).toBe(true)
    expect(h.result.current.notice).toContain('5')
    expect(h.result.current.notice).toContain('2')
  })

  it('abortGrading 失败进 errorMsg;成功返回 true', async () => {
    const h = await mount()
    mocks.abort.mockResolvedValue({ success: false, error: 'no running job' })
    let ok = true
    await act(async () => {
      ok = await h.result.current.abortGrading('t1')
    })
    expect(ok).toBe(false)
    expect(h.result.current.errorMsg).toBe('no running job')

    mocks.abort.mockResolvedValue({ success: true })
    await act(async () => {
      ok = await h.result.current.abortGrading('t1')
    })
    expect(ok).toBe(true)
  })

  it('clearFeedback 清空错误与通知', async () => {
    const h = await mount()
    mocks.deleteTask.mockResolvedValue({ success: false, error: 'x' })
    await act(async () => {
      await h.result.current.deleteTask('t1')
    })
    expect(h.result.current.errorMsg).toBe('x')
    await act(async () => {
      h.result.current.clearFeedback()
    })
    expect(h.result.current.errorMsg).toBeNull()
    expect(h.result.current.notice).toBeNull()
  })
})
