// =============================================================
// useDashboardActions — Dashboard 诊断动作 hook 测试
// 覆盖: runDoctor / runValidate / replayEvents / exportHtmlDashboard
// 的成功/失败/异常分支与 running 状态翻转
// window.api 按 tests/setup.ts 之外的本文件 mock 注入
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAADoctorData, EAAValidateData } from '@shared/types'
import { useDashboardActions } from '../../../../src/renderer/pages/Dashboard/hooks/useDashboardActions'

// ---------- toast mock ----------

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning,
    info: toastMocks.info,
    show: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}))

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  doctor: vi.fn(),
  validate: vi.fn(),
  replay: vi.fn(),
  dashboard: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    eaa: {
      doctor: apiMocks.doctor,
      validate: apiMocks.validate,
      replay: apiMocks.replay,
      dashboard: apiMocks.dashboard,
    },
  }
}

const doctorData: EAADoctorData = {
  healthy: true,
  passed: 3,
  failed: 0,
  students: 10,
  events: 100,
  issues: [],
}

const validateData: EAAValidateData = {
  valid: true,
  total_events: 100,
  errors: [],
  warnings: [],
}

describe('useDashboardActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('初始状态: 数据为 null, 运行标记为 false', () => {
    const { result } = renderHook(() => useDashboardActions())
    expect(result.current.doctorData).toBeNull()
    expect(result.current.doctorRunning).toBe(false)
    expect(result.current.validateData).toBeNull()
    expect(result.current.validateRunning).toBe(false)
  })

  describe('runDoctor', () => {
    it('成功: 写入 doctorData 且不弹 toast', async () => {
      apiMocks.doctor.mockResolvedValue({ success: true, data: doctorData })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runDoctor()
      })

      expect(apiMocks.doctor).toHaveBeenCalledTimes(1)
      expect(result.current.doctorData).toEqual(doctorData)
      expect(result.current.doctorRunning).toBe(false)
      expect(toastMocks.error).not.toHaveBeenCalled()
    })

    it('res.success=false: 弹 error toast, 数据保持 null', async () => {
      apiMocks.doctor.mockResolvedValue({ success: false, data: null })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runDoctor()
      })

      expect(result.current.doctorData).toBeNull()
      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.doctorRunning).toBe(false)
    })

    it('success=true 但 data 为空: 弹 error toast', async () => {
      apiMocks.doctor.mockResolvedValue({ success: true, data: null })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runDoctor()
      })

      expect(result.current.doctorData).toBeNull()
      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })

    it('IPC 抛错: 弹 error toast 且 running 复位', async () => {
      apiMocks.doctor.mockRejectedValue(new Error('ipc down'))
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runDoctor()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.doctorRunning).toBe(false)
    })

    it('执行期间 doctorRunning=true, 完成后复位', async () => {
      let resolveFn!: (v: unknown) => void
      apiMocks.doctor.mockImplementation(
        () => new Promise((res) => { resolveFn = res }),
      )
      const { result } = renderHook(() => useDashboardActions())

      let promise!: Promise<void>
      act(() => {
        promise = result.current.runDoctor()
      })
      expect(result.current.doctorRunning).toBe(true)

      await act(async () => {
        resolveFn({ success: true, data: doctorData })
        await promise
      })
      expect(result.current.doctorRunning).toBe(false)
      expect(result.current.doctorData).toEqual(doctorData)
    })
  })

  describe('runValidate', () => {
    it('成功: 写入 validateData', async () => {
      apiMocks.validate.mockResolvedValue({ success: true, data: validateData })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runValidate()
      })

      expect(result.current.validateData).toEqual(validateData)
      expect(result.current.validateRunning).toBe(false)
    })

    it('失败: 弹 error toast 且数据保持 null', async () => {
      apiMocks.validate.mockResolvedValue({ success: false, data: null })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runValidate()
      })

      expect(result.current.validateData).toBeNull()
      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })

    it('IPC 抛错: 弹 error toast', async () => {
      apiMocks.validate.mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.runValidate()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.validateRunning).toBe(false)
    })
  })

  describe('replayEvents', () => {
    it('成功: 弹 success toast', async () => {
      apiMocks.replay.mockResolvedValue({ success: true })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.replayEvents()
      })

      expect(apiMocks.replay).toHaveBeenCalledTimes(1)
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(toastMocks.error).not.toHaveBeenCalled()
    })

    it('失败与异常: 均弹 error toast', async () => {
      apiMocks.replay.mockResolvedValueOnce({ success: false })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.replayEvents()
      })
      expect(toastMocks.error).toHaveBeenCalledTimes(1)

      apiMocks.replay.mockRejectedValueOnce(new Error('x'))
      await act(async () => {
        await result.current.replayEvents()
      })
      expect(toastMocks.error).toHaveBeenCalledTimes(2)
    })
  })

  describe('exportHtmlDashboard', () => {
    it('成功且返回路径: success toast 包含路径', async () => {
      apiMocks.dashboard.mockResolvedValue({ success: true, data: 'C:\out\dashboard.html' })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.exportHtmlDashboard()
      })

      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(toastMocks.success.mock.calls[0][0]).toContain('dashboard.html')
    })

    it('成功但无路径: 弹 success toast', async () => {
      apiMocks.dashboard.mockResolvedValue({ success: true, data: null })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.exportHtmlDashboard()
      })

      expect(toastMocks.success).toHaveBeenCalledTimes(1)
    })

    it('失败: 优先透出 stderr', async () => {
      apiMocks.dashboard.mockResolvedValue({ success: false, stderr: 'rust panic' })
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.exportHtmlDashboard()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(toastMocks.error.mock.calls[0][0]).toContain('rust panic')
    })

    it('异常: 弹 error toast', async () => {
      apiMocks.dashboard.mockRejectedValue(new Error('no binary'))
      const { result } = renderHook(() => useDashboardActions())

      await act(async () => {
        await result.current.exportHtmlDashboard()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })
})