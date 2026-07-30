// =============================================================
// Tray Service — resolveIconPath / getTrayStatus / updateTray 测试
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = path.join(os.tmpdir(), `tray-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const resourcesDir = path.join(tmpRoot, 'resources')

const mocks = vi.hoisted(() => ({
  resourcesPath: '',
  getSettings: vi.fn(() => ({ general: { minimizeToTray: false } })),
  trayCtor: vi.fn(),
  trayInstance: {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  },
  nativeImageCreate: vi.fn(() => ({ resize: vi.fn(() => ({})) })),
  nativeImageEmpty: vi.fn(() => ({})),
}))

vi.mock('electron', () => ({
  app: { quit: vi.fn(), getPath: vi.fn(() => tmpRoot) },
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  Tray: vi.fn(function () { return mocks.trayInstance }),
  nativeImage: {
    createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({})) })),
    createEmpty: vi.fn(() => ({})),
  },
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))

beforeAll(async () => {
  mocks.resourcesPath = resourcesDir
  Object.defineProperty(process, 'resourcesPath', { value: resourcesDir, configurable: true })
  await fsp.mkdir(resourcesDir, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

describe('resolveIconPath', () => {
  it('图标不存在时返回 undefined', async () => {
    vi.resetModules()
    const { resolveIconPath } = await import('../../src/main/services/tray-service')
    // No icon.ico in any candidate path
    expect(resolveIconPath()).toBeUndefined()
  })

  it('图标存在于 resourcesPath 时返回路径', async () => {
    // Create icon in resourcesDir
    const iconPath = path.join(resourcesDir, 'icon.ico')
    await fsp.writeFile(iconPath, 'fake-icon')

    vi.resetModules()
    const { resolveIconPath } = await import('../../src/main/services/tray-service')
    const result = resolveIconPath()
    expect(result).toBeDefined()
    expect(result).toContain('icon.ico')

    // Cleanup
    await fsp.unlink(iconPath)
  })

  it('图标存在于 resourcesPath/resources 子目录时返回路径', async () => {
    const subDir = path.join(resourcesDir, 'resources')
    await fsp.mkdir(subDir, { recursive: true })
    const iconPath = path.join(subDir, 'icon.ico')
    await fsp.writeFile(iconPath, 'fake-icon')

    vi.resetModules()
    const { resolveIconPath } = await import('../../src/main/services/tray-service')
    const result = resolveIconPath()
    expect(result).toBeDefined()
    expect(result).toContain('icon.ico')

    await fsp.unlink(iconPath)
    await fsp.rmdir(subDir)
  })
})

describe('getTrayStatus', () => {
  it('初始状态 exists=false', async () => {
    vi.resetModules()
    const { getTrayStatus } = await import('../../src/main/services/tray-service')
    const status = getTrayStatus()
    expect(status).toEqual({ exists: false })
  })

  it('返回对象有 exists 属性(布尔)', async () => {
    vi.resetModules()
    const { getTrayStatus } = await import('../../src/main/services/tray-service')
    const status = getTrayStatus()
    expect(typeof status.exists).toBe('boolean')
  })
})

describe('destroyTray', () => {
  it('无 tray 时不报错', async () => {
    vi.resetModules()
    const { destroyTray } = await import('../../src/main/services/tray-service')
    expect(() => destroyTray()).not.toThrow()
  })
})

describe('updateTray', () => {
  it('enabled=true 无图标时不创建 tray', async () => {
    vi.resetModules()
    const { updateTray, getTrayStatus } = await import('../../src/main/services/tray-service')
    updateTray(true)
    expect(getTrayStatus().exists).toBe(false)
  })

  it('enabled=false 无 tray 时不报错', async () => {
    vi.resetModules()
    const { updateTray } = await import('../../src/main/services/tray-service')
    expect(() => updateTray(false)).not.toThrow()
  })
})

describe('initTray', () => {
  it('无图标时跳过创建', async () => {
    vi.resetModules()
    const { initTray, getTrayStatus } = await import('../../src/main/services/tray-service')
    initTray({} as never) // fake window
    expect(getTrayStatus().exists).toBe(false)
  })

  it('minimizeToTray=false 时跳过创建', async () => {
    // Create icon
    const iconPath = path.join(resourcesDir, 'icon.ico')
    await fsp.writeFile(iconPath, 'fake-icon')

    mocks.getSettings.mockReturnValue({ general: { minimizeToTray: false } })

    vi.resetModules()
    const { initTray, getTrayStatus } = await import('../../src/main/services/tray-service')
    initTray({} as never)
    expect(getTrayStatus().exists).toBe(false)

    await fsp.unlink(iconPath)
  })

  it('minimizeToTray=true 且有图标时创建 tray', async () => {
    const iconPath = path.join(resourcesDir, 'icon.ico')
    await fsp.writeFile(iconPath, 'fake-icon')

    mocks.getSettings.mockReturnValue({ general: { minimizeToTray: true } })

    vi.resetModules()
    const { initTray, getTrayStatus, destroyTray } = await import(
      '../../src/main/services/tray-service'
    )
    initTray({} as never)
    expect(getTrayStatus().exists).toBe(true)

    // Cleanup
    destroyTray()
    await fsp.unlink(iconPath)
  })
})
