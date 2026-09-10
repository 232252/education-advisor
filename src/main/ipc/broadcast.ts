// =============================================================
// 主→客户端事件扇出 — Electron 窗口 + WebUI WebSocket
// sendToRenderer 保留对传入 BrowserWindow 的 webContents.send
// (单测仍可观测 fakeWin.webContents.send),同时推给已认证 WS 客户端
// =============================================================

import type { BrowserWindow } from 'electron'

type FanoutListener = (channel: string, payload: unknown) => void

const webUiListeners = new Set<FanoutListener>()

export function addWebUiFanoutListener(listener: FanoutListener): () => void {
  webUiListeners.add(listener)
  return () => {
    webUiListeners.delete(listener)
  }
}

export function fanoutWebUi(channel: string, payload: unknown): void {
  for (const listener of webUiListeners) {
    try {
      listener(channel, payload)
    } catch {
      /* 单个 WS 客户端异常不影响其余 */
    }
  }
}

/** 发往指定 Electron 窗口(若仍存活)并扇出到 WebUI */
export function sendToRenderer(
  win: BrowserWindow | undefined | null,
  channel: string,
  payload: unknown,
): void {
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, payload)
    } catch {
      /* 渲染进程可能已卸载 */
    }
  }
  fanoutWebUi(channel, payload)
}
