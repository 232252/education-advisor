// =============================================================
// 主进程启动共享状态 — 原 main/index.ts 模块级变量集中于此
// (窗口引用 / 退出标记 / 延迟更新检查 timer,跨 bootstrap 模块共享)
// =============================================================

import type { BrowserWindow } from 'electron'

export const mainState = {
  // 全局窗口引用
  mainWindow: null as BrowserWindow | null,
  isQuitting: false,
  // L-6 修复: 启动延迟检查更新的 timer 引用,退出时清理避免回调在已销毁的服务上执行
  updateCheckTimer: null as NodeJS.Timeout | null,
}
