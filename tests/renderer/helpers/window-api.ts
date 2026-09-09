// =============================================================
// window.api 装/卸测试助手 — 此前 12 个文件 27 处 as unknown as 双重断言
// 用法: beforeEach(() => setWindowApi({...})); afterEach(() => clearWindowApi())
// =============================================================

/** 装载 window.api mock */
export function setWindowApi(api: unknown): void {
  ;(window as unknown as { api: unknown }).api = api
}

/** 卸载 window.api(避免跨用例泄漏) */
export function clearWindowApi(): void {
  delete (window as unknown as { api?: unknown }).api
}
