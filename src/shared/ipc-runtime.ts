// =============================================================
// IPC 运行时 — Electron preload 与浏览器 WebUI 共用调用入口
// invoke/on/send 在调用时解析 runtime,模块加载期不碰 electron
// =============================================================

export interface IpcRuntime {
  // 对齐 ipcRenderer.invoke: 各域 API 自行收窄返回值
  // biome-ignore lint/suspicious/noExplicitAny: 见上
  invoke(channel: string, ...args: unknown[]): Promise<any>
  on(channel: string, listener: (data: unknown) => void): () => void
  send(channel: string, ...args: unknown[]): void
}

let runtime: IpcRuntime | null = null

export function setIpcRuntime(next: IpcRuntime): void {
  runtime = next
}

export function getIpcRuntime(): IpcRuntime {
  if (!runtime) {
    throw new Error('window.api is not available. Are you running inside Electron?')
  }
  return runtime
}

// biome-ignore lint/suspicious/noExplicitAny: 与 ipcRenderer.invoke 同形
export function ipcInvoke(channel: string, ...args: unknown[]): Promise<any> {
  return getIpcRuntime().invoke(channel, ...args)
}

export function ipcOn<T>(channel: string, callback: (data: T) => void): () => void {
  return getIpcRuntime().on(channel, callback as (data: unknown) => void)
}

export function ipcSend(channel: string, ...args: unknown[]): void {
  getIpcRuntime().send(channel, ...args)
}
