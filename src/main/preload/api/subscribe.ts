// =============================================================
// Preload API — 事件订阅助手
// 统一「注册监听 → 返回退订函数」模式(各域 api 文件共用)
// =============================================================

import type { IpcRendererEvent } from 'electron'
import { ipcRenderer } from 'electron'

/** 订阅主进程事件,返回退订函数 */
export function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}
