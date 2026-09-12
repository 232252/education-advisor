// =============================================================
// 渲染端运行时 — Electron 桌面 vs 浏览器 WebUI
//
// 不能用 location.protocol 判断: Vite 开发态桌面窗口也是 http://localhost。
// 仅在 installWebBridge 连上网关后打标。
// =============================================================

let webUi = false

export function setWebUiRuntime(on: boolean): void {
  webUi = on
}

export function isWebUiRuntime(): boolean {
  return webUi
}

export function readWebUiToken(): string {
  try {
    return sessionStorage.getItem('ea-webui-k') || ''
  } catch {
    return ''
  }
}
