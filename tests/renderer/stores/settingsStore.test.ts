// =============================================================
// Settings Store 测试 — fetchSettings/updateSetting/resetSettings
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn().mockResolvedValue({ success: true })
const mockReset = vi.fn().mockResolvedValue({ success: true })

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    settings: {
      get: mockGet,
      set: mockSet,
      reset: mockReset,
    },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const { useSettingsStore } = await import('../../../src/renderer/stores/settingsStore')

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ settings: null, loading: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('初始 settings 应为 null', () => {
    expect(useSettingsStore.getState().settings).toBeNull()
  })

  it('fetchSettings 应从 IPC 加载', async () => {
    const data = { general: { theme: 'light' } }
    mockGet.mockResolvedValueOnce(data)
    await useSettingsStore.getState().fetchSettings()
    const s = useSettingsStore.getState()
    expect(s.settings).toEqual(data)
    expect(s.loading).toBe(false)
  })

  it('fetchSettings 失败应设置 loading=false 但不抛错', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'))
    await useSettingsStore.getState().fetchSettings()
    expect(useSettingsStore.getState().loading).toBe(false)
  })

  it('updateSetting 应调用 set + 重新 fetch', async () => {
    const data = { general: { theme: 'light' } }
    mockGet.mockResolvedValueOnce(data)
    await useSettingsStore.getState().updateSetting('general.theme', 'light')
    expect(mockSet).toHaveBeenCalledWith('general.theme', 'light')
    expect(useSettingsStore.getState().settings).toEqual(data)
  })

  it('updateSetting 失败不应抛错', async () => {
    mockSet.mockRejectedValueOnce(new Error('save failed'))
    await useSettingsStore.getState().updateSetting('x', 'y')
    // 不应抛错
  })

  it('resetSettings 应调用 reset + 重新 fetch', async () => {
    const data = { general: { theme: 'dark' } }
    mockGet.mockResolvedValueOnce(data)
    await useSettingsStore.getState().resetSettings()
    expect(mockReset).toHaveBeenCalled()
    expect(useSettingsStore.getState().settings).toEqual(data)
  })
})
