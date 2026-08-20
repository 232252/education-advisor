// =============================================================
// update-service.ts — M31 下载/安装层单元测试
// mock electron-updater / electron / node:https / settings-service
// 覆盖: (a) 检查→下载→下载完成→quitAndInstall 完整流
//       (b) 已是最新  (c) 下载失败错误处理  (d) 进度推送
//       (e) portable 检测 (f) dev 模式 / 未配置源 / 非 GitHub URL
// =============================================================

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- hoisted mocks (vi.mock 工厂提升后仍可引用) ----
const mocks = vi.hoisted(() => {
  /** electron-updater 事件处理器注册表 (on 注册时捕获) */
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const electron = {
    app: {
      getPath: () => '/tmp/update-svc-test',
      isPackaged: true,
      getVersion: () => '0.1.0',
    },
    dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  }
  const autoUpdater = {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue(['/tmp/pending/Education-Advisor-Setup.exe']),
    quitAndInstall: vi.fn(),
    // 注册时捕获事件处理器,供测试手动触发
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb
    }),
    autoDownload: true,
    autoInstallOnAppQuit: false,
  }
  const getSettings = vi.fn().mockReturnValue({
    general: { updateUrl: 'https://github.com/232252/education-advisor' },
  })
  const httpsGet = vi.fn()
  return { handlers, electron, autoUpdater, getSettings, httpsGet }
})

vi.mock('electron', () => mocks.electron)
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))
vi.mock('node:https', () => ({ default: { get: mocks.httpsGet } }))

import { updateService } from '../../src/main/services/update-service'

/** 构造 GitHub Releases API 假响应 (tag 对应 latest release) */
function mockRelease(tagName: string): void {
  mocks.httpsGet.mockImplementation(
    (
      _url: string,
      _opts: unknown,
      cb: (res: unknown) => void,
    ) => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number
        setEncoding: () => void
        resume: () => void
        destroy: () => void
      }
      res.statusCode = 200
      res.setEncoding = () => {}
      res.resume = () => {}
      res.destroy = () => {}
      cb(res)
      queueMicrotask(() => {
        res.emit(
          'data',
          JSON.stringify({
            tag_name: tagName,
            html_url: 'https://github.com/232252/education-advisor/releases/latest',
            body: 'release notes',
            published_at: '2026-08-01T00:00:00Z',
          }),
        )
        res.emit('end')
      })
      const req = new EventEmitter() as EventEmitter & { destroy: () => void }
      req.destroy = () => {}
      return req
    },
  )
}

/** 触发已注册的 electron-updater 事件 */
function fire(event: string, ...args: unknown[]): void {
  const h = mocks.handlers[event]
  if (!h) throw new Error(`handler for "${event}" not registered`)
  h(...args)
}

beforeEach(() => {
  mocks.electron.app.isPackaged = true
  delete process.env.PORTABLE_EXECUTABLE_DIR
  mocks.electron.app.getVersion = () => '0.1.0'
  mocks.getSettings.mockReturnValue({
    general: { updateUrl: 'https://github.com/232252/education-advisor' },
  })
  mocks.autoUpdater.setFeedURL.mockClear()
  mocks.autoUpdater.checkForUpdates.mockClear()
  mocks.autoUpdater.checkForUpdates.mockResolvedValue(null)
  mocks.autoUpdater.downloadUpdate.mockClear()
  mocks.autoUpdater.downloadUpdate.mockResolvedValue(['/tmp/pending/setup.exe'])
  mocks.autoUpdater.quitAndInstall.mockClear()
  mocks.httpsGet.mockReset()
  mockRelease('v9.9.9')
})

describe('M31 完整流: 检查 → 下载 → 下载完成 → quitAndInstall', () => {
  it('(a) 发现新版本 → downloadUpdate 配置 feed 并下载 → update-downloaded 推送 → installUpdate 调 quitAndInstall', async () => {
    mockRelease('v9.9.9')
    const onProgress = vi.fn()
    updateService.setProgressListener(onProgress)

    // 1. 检查更新: GitHub API 返回 v9.9.9 > 当前 0.1.0
    const info = await updateService.checkForUpdates()
    expect(info.hasUpdate).toBe(true)
    expect(info.latestVersion).toBe('9.9.9')
    expect(info.portable).toBe(false)
    expect(info.message).toContain('发现新版本')

    // 2. 触发下载: feed 指向 settings 里的 GitHub 仓库
    const dl = await updateService.downloadUpdate()
    expect(dl.success).toBe(true)
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: '232252',
      repo: 'education-advisor',
    })
    // downloadUpdate 前必须先 checkForUpdates (electron-updater 契约)
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    // 手动下载 + 退出时自动安装
    expect(mocks.autoUpdater.autoDownload).toBe(false)
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)

    // 3. 下载完成事件 (sha512 校验通过后才会触发) → 推送 downloaded
    fire('update-downloaded', { version: '9.9.9' })
    expect(onProgress).toHaveBeenCalledWith({
      status: 'downloaded',
      percent: 100,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      version: '9.9.9',
      message: '',
    })

    // 4. 重启安装 → quitAndInstall
    const inst = await updateService.installUpdate()
    expect(inst).toEqual({ success: true, portable: false })
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('M31 已是最新版本', () => {
  it('(b) latest 与当前版本相同 → hasUpdate=false 且不进入下载', async () => {
    mockRelease('v0.1.0')
    const info = await updateService.checkForUpdates()
    expect(info.hasUpdate).toBe(false)
    expect(info.latestVersion).toBe('0.1.0')
    expect(info.message).toContain('已是最新版本')
  })
})

describe('M31 下载失败错误处理', () => {
  it('(c) downloadUpdate reject (如 sha512 校验失败) → { success:false, error }', async () => {
    mockRelease('v9.9.9')
    await updateService.checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockRejectedValueOnce(
      new Error('sha512 checksum mismatch, expected AAA got BBB'),
    )
    const r = await updateService.downloadUpdate()
    expect(r.success).toBe(false)
    expect(r.error).toContain('sha512 checksum mismatch')
  })

  it('(c2) checkForUpdates (electron-updater) reject → 错误上抛为 { success:false }', async () => {
    mockRelease('v9.9.9')
    mocks.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('Network error'))
    const r = await updateService.downloadUpdate()
    expect(r.success).toBe(false)
    expect(r.error).toContain('Network error')
  })

  it('(c3) error 事件推送 status=error + message', async () => {
    mockRelease('v9.9.9')
    await updateService.checkForUpdates()
    const onProgress = vi.fn()
    updateService.setProgressListener(onProgress)
    await updateService.downloadUpdate()

    fire('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: 'net::ERR_INTERNET_DISCONNECTED',
      }),
    )
  })
})

describe('M31 进度推送', () => {
  it('(d) download-progress 事件 → progressListener 收到 downloading 载荷', async () => {
    mockRelease('v9.9.9')
    await updateService.checkForUpdates()
    const onProgress = vi.fn()
    updateService.setProgressListener(onProgress)
    await updateService.downloadUpdate()

    fire('download-progress', {
      percent: 42.5,
      transferred: 4250,
      total: 10000,
      bytesPerSecond: 1024,
    })
    expect(onProgress).toHaveBeenCalledWith({
      status: 'downloading',
      percent: 42.5,
      transferred: 4250,
      total: 10000,
      bytesPerSecond: 1024,
      version: '',
      message: '',
    })
  })

  it('(d2) 未注册 progressListener 时事件不抛错', async () => {
    mockRelease('v9.9.9')
    await updateService.checkForUpdates()
    updateService.setProgressListener(() => {
      throw new Error('listener boom')
    })
    const r = await updateService.downloadUpdate()
    expect(r.success).toBe(true)
    // 监听器抛错不中断流程
    expect(() => fire('download-progress', { percent: 1 })).not.toThrow()
    updateService.setProgressListener(() => {})
  })
})

describe('M31 portable / dev 模式检测', () => {
  it('(e) PORTABLE_EXECUTABLE_DIR 注入 → 不下载不安装,提示手动替换', async () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\Apps'
    try {
      expect(updateService.isPortable()).toBe(true)
      // checkForUpdates 仍可用(带 portable 标记,renderer 显示手动替换提示)
      mockRelease('v9.9.9')
      const info = await updateService.checkForUpdates()
      expect(info.hasUpdate).toBe(true)
      expect(info.portable).toBe(true)

      const dl = await updateService.downloadUpdate()
      expect(dl.success).toBe(false)
      expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()

      const inst = await updateService.installUpdate()
      expect(inst.success).toBe(false)
      expect(inst.portable).toBe(true)
      expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    } finally {
      delete process.env.PORTABLE_EXECUTABLE_DIR
    }
  })

  it('(f) dev 模式 (app.isPackaged=false) → isPortable=true,拒绝自动下载', async () => {
    mocks.electron.app.isPackaged = false
    try {
      expect(updateService.isPortable()).toBe(true)
      const dl = await updateService.downloadUpdate()
      expect(dl.success).toBe(false)
      expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    } finally {
      mocks.electron.app.isPackaged = true
    }
  })
})

describe('M31 更新源配置校验', () => {
  it('未配置 updateUrl → downloadUpdate 返回配置错误', async () => {
    mocks.getSettings.mockReturnValueOnce({ general: { updateUrl: '' } })
    const r = await updateService.downloadUpdate()
    expect(r.success).toBe(false)
    expect(r.error).toContain('未配置更新源')
  })

  it('非 GitHub 仓库 URL → configureFeed 拒绝', async () => {
    mocks.getSettings.mockReturnValueOnce({ general: { updateUrl: 'https://gitlab.com/owner/repo' } })
    const r = await updateService.downloadUpdate()
    expect(r.success).toBe(false)
    expect(r.error).toContain('Invalid GitHub repo URL')
  })

  it('GitHub API 非 200 → 检查更新失败消息(保留原有检查层行为)', async () => {
    mocks.httpsGet.mockImplementationOnce(
      (_url: string, _opts: unknown, cb: (res: unknown) => void) => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number
          resume: () => void
        }
        res.statusCode = 403
        res.resume = () => {}
        cb(res)
        const req = new EventEmitter() as EventEmitter & { destroy: () => void }
        req.destroy = () => {}
        return req
      },
    )
    const info = await updateService.checkForUpdates()
    expect(info.hasUpdate).toBe(false)
    expect(info.message).toContain('检查更新失败')
    expect(info.message).toContain('403')
  })
})
