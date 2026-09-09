// =============================================================
// ipc/progress — 批量写 handler 的进度推送器
// (class:assign 与 students:import-excel 共用;新批量 handler 直接复用)
// =============================================================

import type { IpcMainInvokeEvent } from 'electron'

/** 构造向渲染进程推送进度的安全发送器(窗口销毁/已卸载时静默跳过)。
 *  countKey 是计数字段的载荷名(assigned/imported,与渲染端契约对齐)。 */
export function makeProgressSender(
  e: IpcMainInvokeEvent,
  channel: string,
  countKey: 'assigned' | 'imported',
): (current: number, total: number, done: number, lastName: string) => void {
  return (current, total, done, lastName) => {
    try {
      if (!e.sender.isDestroyed()) {
        e.sender.send(channel, { current, total, [countKey]: done, lastName })
      }
    } catch {
      /* 渲染进程可能已卸载，忽略 */
    }
  }
}
