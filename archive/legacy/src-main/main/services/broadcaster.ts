// =============================================================
// 主进程广播器 — 让 IPC handler 与 Agent 工具都能向渲染端推送事件
//
// 为什么需要这个模块？
//   - eaa-handlers.ts 直接持有 BrowserWindow，可直接 win.webContents.send
//   - eaa-tools.ts（Agent 工具）在 agent-service.ts 中被调用，agent-service
//     不持有 BrowserWindow，需要一个全局可达的 broadcaster
//   - 一些 cron 触发的 Agent 任务更是和窗口生命周期无关
//
// 设计：
//   - 单一全局 singleton 持有当前主窗口引用
//   - main/index.ts 在窗口创建时调用 setMainWindow，窗口销毁时 clearMainWindow
//   - 任何模块 import 后即可调用 broadcastXxx，安全无窗口时静默 no-op
// =============================================================

import type { BrowserWindow } from 'electron'
import * as IPC from '../../shared/ipc-channels'

class MainBroadcaster {
  private _win: BrowserWindow | null = null

  /** 注册主窗口（在 app.whenReady().then(() => createWindow()) 后调用） */
  setMainWindow(win: BrowserWindow): void {
    this._win = win
  }

  /** 主窗口销毁时清理（防止 webContents 已销毁的 BroadcastChannel 报错） */
  clearMainWindow(): void {
    this._win = null
  }

  /** 当前是否有可用窗口 */
  hasWindow(): boolean {
    return this._win !== null && !this._win.isDestroyed()
  }

  /**
   * 底层广播：发送 channel + payload 到所有 webContents
   * 安全 no-op：无窗口时不抛错
   */
  private send(channel: string, payload: unknown): void {
    const w = this._win
    if (!w || w.isDestroyed()) return
    try {
      w.webContents.send(channel, payload)
    } catch (err) {
      // 静默 — 广播失败不应阻塞主流程
      console.warn(`[Broadcaster] Failed to send ${channel}:`, err)
    }
  }

  // -------- EAA 事件快捷方法 --------

  broadcastEventAdded(payload: {
    studentName: string
    reasonCode: string
    delta?: number
    at: number
  }): void {
    this.send(IPC.IPC_EAA_EVENT_ADDED, payload)
  }

  broadcastEventReverted(payload: { eventId: string; at: number }): void {
    this.send(IPC.IPC_EAA_EVENT_REVERTED, payload)
  }

  broadcastStudentAdded(payload: { name: string; at: number }): void {
    this.send(IPC.IPC_EAA_STUDENT_ADDED, payload)
  }

  broadcastStudentDeleted(payload: { name: string; at: number }): void {
    this.send(IPC.IPC_EAA_STUDENT_DELETED, payload)
  }
}

export const mainBroadcaster = new MainBroadcaster()
