// =============================================================
// sys:get-runtime-versions — 关于页底层版本的单一来源
//
// dsh 版本来自 dsh-version（装配可覆盖），dsh-im 来自 im-url 的 pin，
// Electron 来自真实进程版本。此前关于页把三者写死在文案里，
// 升级必漂移（Electron 43.2 vs 实际 45 已经漂移）。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

// 与 sys-handlers-path-traversal 测试一致：node 环境没有打包资源路径，
// agent-service 等模块顶层会读它。必须放在 hoisted 块里先于 import 执行。
vi.hoisted(() => {
  if (typeof process.resourcesPath !== 'string' || !process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: process.env.TEMP || process.env.TMPDIR || '/tmp',
      configurable: true,
    })
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/eaa-sys-versions-test'),
    getVersion: vi.fn(() => '3.3.7-beta.6'),
    isPackaged: false,
  },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
  shell: { openExternal: vi.fn() },
}))

vi.mock('../../src/main/services/update-service', () => ({
  updateService: {
    checkForUpdates: vi.fn(),
    showUpdateDialog: vi.fn(),
    setProgressListener: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
  },
}))

vi.mock('../../src/main/services/webui-service', () => ({
  webUiService: { getStatus: vi.fn(), start: vi.fn(), stop: vi.fn() },
}))

import * as IPC from '@shared/ipc-channels'
import { registerSysHandlers } from '../../src/main/ipc/sys-handlers'
import { configureDshRuntimeVersion } from '../../src/main/services/dsh/dsh-version'
import { DSH_IM_VERSION } from '../../src/main/services/dsh/im-url'

describe('sys:get-runtime-versions', () => {
  it('返回 dsh / dsh-im / electron 三个版本，dsh 跟随装配注入', async () => {
    registerSysHandlers({} as never)
    const handler = handlers.get(IPC.IPC_SYS_GET_RUNTIME_VERSIONS)
    expect(handler).toBeTruthy()

    configureDshRuntimeVersion('9.9.9-eaa-test')
    const injected = (await handler?.({} as never)) as {
      dsh: string
      dshIm: string
      electron: string
    }
    expect(injected.dsh).toBe('9.9.9-eaa-test')
    expect(injected.dshIm).toBe(DSH_IM_VERSION)
    expect(injected.electron).toBe(process.versions.electron ?? '')

    configureDshRuntimeVersion('')
    const fallback = (await handler?.({} as never)) as { dsh: string }
    expect(fallback.dsh).toBe('0.2.2-rc.1')
  })
})