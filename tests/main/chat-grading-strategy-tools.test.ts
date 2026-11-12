// =============================================================
// 对话批改写入工具：策略参数、extreme 确认、改策略
// =============================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

const settingsState = vi.hoisted(() => ({
  grading: { provider2: 'p', model2: 'm' } as { provider2?: string; model2?: string },
}))

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => ({ hint: 'started', gradingStrategy: 'fast' })),
  getTask: vi.fn(),
  updateTask: vi.fn(),
}))

vi.mock('../../src/main/services/grading/batch-from-files', () => ({
  startGradingFromFiles: mocks.start,
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {
    getTask: mocks.getTask,
    updateTask: mocks.updateTask,
  },
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => ({ grading: settingsState.grading }),
  },
}))

import { gradingFromFilesTool, gradingSetStrategyTool } from '../../src/main/services/eaa/tools/grading-write-tools'
import { DUAL_MODEL_MISSING } from '../../src/main/services/grading/dual-model-guard'
import {
  resetTeacherConfirmForTests,
  resolveTeacherConfirm,
  setTeacherConfirmSender,
} from '../../src/main/services/teacher-confirm'

const files = {
  confirm: true,
  name: '期中',
  sample_paths: ['/tmp/a.pdf'],
  homework_paths: ['/tmp/b.zip'],
}

afterEach(() => {
  vi.clearAllMocks()
  resetTeacherConfirmForTests()
  settingsState.grading = { provider2: 'p', model2: 'm' }
})

describe('eaa_grading_from_files 参数', () => {
  it('非极致缺 confirm 时不建任务', async () => {
    await expect(
      gradingFromFilesTool.execute('c1', { ...files, confirm: false, grading_strategy: 'fast' }),
    ).rejects.toThrow('confirm')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('extreme 不把 confirm 当授权，策略原样传给开批', async () => {
    await gradingFromFilesTool.execute('c2', {
      ...files,
      confirm: false,
      grading_strategy: 'extreme',
    })
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ gradingStrategy: 'extreme', name: '期中' }),
      undefined,
    )
  })

  it('fast 与 grading_mode 同时传入且互不覆盖', async () => {
    await gradingFromFilesTool.execute('c3', {
      ...files,
      grading_mode: 'strict',
      grading_strategy: 'fast',
    })
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ gradingMode: 'strict', gradingStrategy: 'fast' }),
      undefined,
    )
  })
})

describe('eaa_grading_set_strategy', () => {
  it('改成 extreme 时教师取消则不更新', async () => {
    mocks.getTask.mockResolvedValue({ id: 'grading-1', name: '周测', gradingStrategy: 'standard' })
    setTeacherConfirmSender((req) => resolveTeacherConfirm(req.id, false))
    await expect(
      gradingSetStrategyTool.execute('s1', {
        task_id: 'grading-1',
        grading_strategy: 'extreme',
      }),
    ).rejects.toThrow('未创建或更改任务')
    expect(mocks.updateTask).not.toHaveBeenCalled()
  })

  it('改成 extreme 且教师确认后才写入', async () => {
    mocks.getTask.mockResolvedValue({ id: 'grading-1', name: '周测', gradingStrategy: 'fast' })
    mocks.updateTask.mockImplementation(async (_id: string, patch: { gradingStrategy: string }) => ({
      id: 'grading-1',
      gradingStrategy: patch.gradingStrategy,
    }))
    setTeacherConfirmSender((req) => {
      expect(req.detail).toBe('周测')
      resolveTeacherConfirm(req.id, true)
    })
    const result = await gradingSetStrategyTool.execute('s2', {
      task_id: 'grading-1',
      grading_strategy: 'extreme',
    })
    expect(mocks.updateTask).toHaveBeenCalledWith('grading-1', { gradingStrategy: 'extreme' })
    expect(result.content[0]).toMatchObject({ type: 'text' })
  })

  it('已经是 extreme 时不再弹确认', async () => {
    mocks.getTask.mockResolvedValue({ id: 'grading-1', name: '周测', gradingStrategy: 'extreme' })
    mocks.updateTask.mockResolvedValue({ id: 'grading-1', gradingStrategy: 'extreme' })
    await gradingSetStrategyTool.execute('s3', {
      task_id: 'grading-1',
      grading_strategy: 'extreme',
    })
    expect(mocks.updateTask).toHaveBeenCalled()
  })

  it('dual 未配置第二模型时不改策略', async () => {
    settingsState.grading = {}
    mocks.getTask.mockResolvedValue({ id: 'grading-1', name: '周测', gradingStrategy: 'standard' })
    await expect(
      gradingSetStrategyTool.execute('s4', { task_id: 'grading-1', grading_strategy: 'dual' }),
    ).rejects.toThrow(DUAL_MODEL_MISSING)
    expect(mocks.updateTask).not.toHaveBeenCalled()
    expect(mocks.getTask).not.toHaveBeenCalled()
  })
})
