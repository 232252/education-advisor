// =============================================================
// Theme Service 测试 — syncNativeTheme 读写与降级
// 覆盖:
//   - settings.general.theme(dark/light/system) 同步写入 nativeTheme.themeSource
//   - settingsService 抛错时降级为 no-op(记 warn,不抛异常)
//   - nativeTheme 不可用(setter 抛错,如 headless/CI)时降级为 no-op
// electron.nativeTheme / settings-service / logger 全部 mock,
// 与现有主进程测试的 vi.hoisted + vi.mock 约定一致。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  themeSource: 'system' as string,
  setterThrows: false,
  settingsGet: vi.fn(),
  log: vi.fn(),
}))

vi.mock('electron', () => ({
  nativeTheme: {
    get themeSource() {
      return mocks.themeSource
    },
    set themeSource(v: string) {
      if (mocks.setterThrows) throw new Error('nativeTheme unavailable (headless)')
      mocks.themeSource = v
    },
    shouldUseDarkColors: false,
    prefersReducedTransparency: false,
    shouldUseDarkColorsForSystemIntegratedUI: false,
  },
}))

vi.mock('../../src/main/utils/logger', () => ({
  log: mocks.log,
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.settingsGet },
}))

const { syncNativeTheme } = await import('../../src/main/services/theme-service')

function settingsWithTheme(theme: string): Record<string, unknown> {
  return { general: { theme } }
}

describe('syncNativeTheme', () => {
  beforeEach(() => {
    mocks.themeSource = 'system'
    mocks.setterThrows = false
    mocks.settingsGet.mockReset()
    mocks.log.mockReset()
  })

  it('theme=dark 应将 nativeTheme.themeSource 写为 dark', () => {
    mocks.settingsGet.mockReturnValue(settingsWithTheme('dark'))
    syncNativeTheme()
    expect(mocks.themeSource).toBe('dark')
    expect(mocks.log).toHaveBeenCalledWith(
      'info',
      'theme',
      expect.stringContaining('themeSource=dark'),
    )
  })

  it('theme=light 应将 nativeTheme.themeSource 写为 light', () => {
    mocks.themeSource = 'dark' // 先污染,确认真的被改写而非保持原值
    mocks.settingsGet.mockReturnValue(settingsWithTheme('light'))
    syncNativeTheme()
    expect(mocks.themeSource).toBe('light')
  })

  it('theme=system 应将 nativeTheme.themeSource 写为 system(跟随 OS)', () => {
    mocks.themeSource = 'dark'
    mocks.settingsGet.mockReturnValue(settingsWithTheme('system'))
    syncNativeTheme()
    expect(mocks.themeSource).toBe('system')
  })

  it('settingsService 抛错时应降级为 no-op(不抛异常、不修改 themeSource、记 warn)', () => {
    mocks.settingsGet.mockImplementation(() => {
      throw new Error('settings not ready')
    })
    expect(() => syncNativeTheme()).not.toThrow()
    expect(mocks.themeSource).toBe('system')
    expect(mocks.log).toHaveBeenCalledWith(
      'warn',
      'theme',
      expect.stringContaining('syncNativeTheme failed'),
    )
  })

  it('nativeTheme 不可用(setter 抛错)时应降级为 no-op 并记 warn', () => {
    mocks.setterThrows = true
    mocks.settingsGet.mockReturnValue(settingsWithTheme('dark'))
    expect(() => syncNativeTheme()).not.toThrow()
    expect(mocks.themeSource).toBe('system')
    expect(mocks.log).toHaveBeenCalledWith(
      'warn',
      'theme',
      expect.stringContaining('syncNativeTheme failed'),
    )
  })
})
