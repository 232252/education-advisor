// =============================================================
// 主进程/预载 electron 测试助手 — 此前 5 份 preload 测试各抄一份 mock 脚手架
// 用法(与 helpers/mock-toast 同款 async-import 工厂,规避 vi.hoisted 时序):
//   vi.mock('electron', async () => (await import('<rel>/helpers/electron-ipc')).mockIpcRendererModule())
//   import { ipcMocks } from '<rel>/helpers/electron-ipc'
//   const mocks = ipcMocks
// =============================================================

import { vi } from 'vitest'

/** ipcRenderer mock 单例(invoke/on/removeListener/send;dispatchEvent 供 theme-changed 派发断言) */
export const ipcMocks = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  dispatchEvent: vi.fn(),
}

/** vi.mock('electron', ...) 工厂 */
export function mockIpcRendererModule() {
  return { ipcRenderer: ipcMocks }
}

/** 伪造 BrowserWindow(webContents.send 可观测;isDestroyed 恒 false) */
export function makeFakeWindow(send: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    webContents: { send },
    isDestroyed: () => false,
  } as unknown as import('electron').BrowserWindow
}
