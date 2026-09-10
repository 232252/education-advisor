// =============================================================
// Preload 脚本 — contextBridge 安全桥接
// 在渲染进程暴露 window.api，类型安全地调用主进程功能
//
// 最小权限原则:
// - 每个方法标注权限级别: [r] read-only / [w] write / [c] critical
// - [c] critical 方法应在 UI 层加二次确认(删除/重置/外部链接等)
// - 不暴露 ipcRenderer/fs/path/process 等危险 API
// - 事件订阅返回取消订阅函数,避免泄漏监听器
//
// ⚠ 形状契约: window.api 的键名/参数/返回与 renderer/lib/ipc-client.ts
//   的 WindowAPI 接口一一对应,不得改动
// =============================================================

import { setIpcRuntime } from '@shared/ipc-runtime'
import { contextBridge, ipcRenderer } from 'electron'
import { createWindowApi } from './api/create-window-api'

setIpcRuntime({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on(channel, listener) {
    const handler = (_e: unknown, data: unknown) => listener(data)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args)
  },
})

contextBridge.exposeInMainWorld('api', createWindowApi())
