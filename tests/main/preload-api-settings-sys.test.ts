// =============================================================
// Preload API — Settings / Sys / Skill / Profile / Privacy 域测试
// settings.set('general.theme') 需要 window.dispatchEvent,提供 stub
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatchEvent: vi.fn(),
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
import { settingsApi } from '../../src/main/preload/api/settings'
import { sysApi } from '../../src/main/preload/api/sys'
import { skillApi } from '../../src/main/preload/api/skill'
import { profileApi } from '../../src/main/preload/api/profile'
import { privacyApi } from '../../src/main/preload/api/privacy'

describe('settingsApi / sysApi / skillApi / profileApi / privacyApi', () => {
  beforeAll(() => {
    // settings.set 的 theme 分支引用全局 window(node 环境无 window)
    ;(globalThis as Record<string, unknown>).window = { dispatchEvent: mocks.dispatchEvent }
    if (typeof (globalThis as Record<string, unknown>).CustomEvent === 'undefined') {
      ;(globalThis as Record<string, unknown>).CustomEvent = class {
        type: string
        detail: unknown
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type
          this.detail = init?.detail
        }
      }
    }
  })
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).window
  })
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    mocks.dispatchEvent.mockReset()
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
  })

  // ===== settings =====
  it('settings.get / reset', () => {
    void settingsApi.get()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SETTINGS_GET)
    void settingsApi.reset()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SETTINGS_RESET)
  })

  it('settings.set: 非 theme 路径不派发事件', async () => {
    await settingsApi.set('general.language', 'en-US')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SETTINGS_SET, 'general.language', 'en-US')
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it('settings.set: general.theme 派发 theme-changed 事件(R169)', async () => {
    await settingsApi.set('general.theme', 'dark')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SETTINGS_SET, 'general.theme', 'dark')
    expect(mocks.dispatchEvent).toHaveBeenCalledTimes(1)
    const evt = mocks.dispatchEvent.mock.calls[0][0] as { type: string; detail: unknown }
    expect(evt.type).toBe('theme-changed')
    expect(evt.detail).toBe('dark')
  })

  it('settings.set: theme 路径但值非字符串时不派发', async () => {
    await settingsApi.set('general.theme', 123)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SETTINGS_SET, 'general.theme', 123)
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  // ===== sys =====
  it('sys.openDialog / saveDialog / getPath / checkUpdate / showUpdateDialog / readFile', () => {
    const opts = { title: '选文件' }
    void sysApi.openDialog(opts)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_OPEN_DIALOG, opts)

    void sysApi.saveDialog({ defaultPath: 'a.txt' })
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_SAVE_DIALOG, { defaultPath: 'a.txt' })

    void sysApi.getPath('downloads')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_GET_PATH, 'downloads')

    void sysApi.checkUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_CHECK_UPDATE)

    void sysApi.showUpdateDialog()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_SHOW_UPDATE_DIALOG)

    void sysApi.readFile('C:/tmp/a.txt')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_READ_FILE, 'C:/tmp/a.txt')
  })

  // ===== sys (M31 自动更新) =====
  it('sys.downloadUpdate / installUpdate 走对应 IPC 通道', async () => {
    void sysApi.downloadUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_DOWNLOAD_UPDATE)

    void sysApi.installUpdate()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SYS_INSTALL_UPDATE)
  })

  it('sys.onUpdateProgress 订阅/退订 update-progress 事件', () => {
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
    const cb = vi.fn()
    const unsub = sysApi.onUpdateProgress(cb)

    const [channel, listener] = mocks.on.mock.calls[0] as [
      string,
      (e: unknown, info: unknown) => void,
    ]
    expect(channel).toBe(IPC.IPC_SYS_UPDATE_PROGRESS)
    // 事件到达时回调收到载荷
    listener({}, { status: 'downloading', percent: 50 })
    expect(cb).toHaveBeenCalledWith({ status: 'downloading', percent: 50 })

    unsub()
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.IPC_SYS_UPDATE_PROGRESS, listener)
  })

  // ===== skill =====
  it('skill.list / get / save / delete', () => {
    void skillApi.list()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SKILL_LIST)
    void skillApi.get('my-skill')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SKILL_GET, 'my-skill')
    void skillApi.save('my-skill', '# content')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SKILL_SAVE, 'my-skill', '# content')
    void skillApi.delete('my-skill')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_SKILL_DELETE, 'my-skill')
  })

  // ===== profile =====
  it('profile.get / set', () => {
    void profileApi.get('小明')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PROFILE_GET, '小明')
    const data = { note: '三好学生' }
    void profileApi.set('小明', data)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PROFILE_SET, '小明', data)
  })

  // ===== privacy =====
  it('privacy.init / load / list / add', () => {
    void privacyApi.init('pw123', true)
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_INIT, 'pw123', true)

    void privacyApi.load('pw123')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_LOAD, 'pw123')

    void privacyApi.list('pw123')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_LIST, 'pw123')

    void privacyApi.add('student', '小明')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_ADD, 'student', '小明')
  })

  it('privacy.dryrun / backup / lock / status', () => {
    void privacyApi.dryrun('原始文本')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_DRYRUN, '原始文本')

    void privacyApi.backup('C:/backup.json')
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_BACKUP, 'C:/backup.json')

    void privacyApi.lock()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_LOCK)

    void privacyApi.status()
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.IPC_PRIVACY_STATUS)
  })
})