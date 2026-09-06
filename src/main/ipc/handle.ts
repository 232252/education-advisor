// =============================================================
// ipc/handle — ipcMain.handle 注册包装
//
// 统一百余个 handler 的「调服务 → 失败打日志 → 返回失败信封」骨架:
//   - 日志格式与旧手写 catch 逐字一致: `[IPC] <标签>: <msg>`
//     标签默认 `${channel} failed`(通道值即日志标签,如 'skill:list');
//     日志含参数插值的 handler(如 `cron:update failed for "${id}"`)
//     传 opts.label 从参数构造,文案逐字保留
//   - 默认失败信封 { success:false, error: msg };数组/单值/复合返回域
//     经 opts.onError 定制
//   - opts.timer 接入 startIpcTimer 计时(原 try/finally stop 样板收口)
//   - fn 首参是 IpcMainInvokeEvent(与原生 handle 一致),不用可写 _e
//   - 兼容一期位置参数写法 handleIpc(ch, fn, onErrorFn)
// =============================================================

import { startIpcTimer } from '@shared/debug'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { errText } from '../utils/err-text'

export function handleIpc<A extends unknown[]>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => unknown,
  opts?:
    | ((msg: string) => unknown)
    | {
        /** 失败返回值(默认 { success:false, error: msg }) */
        onError?: (msg: string) => unknown
        /**
         * 失败日志标签主体(不含 '[IPC] ' 前缀与结尾冒号),按 handler 参数插值,
         * 如 (id) => `cron:update failed for "${id}"`。参数用 any[] 以免参与
         * A 的泛型推断(推断冲突会把 A 错误收窄到 label 的参数个数)。
         */
        // biome-ignore lint/suspicious/noExplicitAny: 见上 — any[] 刻意阻断 label 参数参与 A 的推断
        label?: (...args: any[]) => string
        /** startIpcTimer 计时标签: 调用全程计时,finally 中 stop(原 try/finally 样板收口) */
        timer?: string
      },
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: A) => {
    const stop = opts && typeof opts !== 'function' && opts.timer ? startIpcTimer(opts.timer) : null
    try {
      return await fn(event, ...args)
    } catch (err: unknown) {
      const msg = errText(err)
      const onError = typeof opts === 'function' ? opts : opts?.onError
      const tag =
        opts && typeof opts !== 'function' && opts.label ? opts.label(...args) : `${channel} failed`
      console.error(`[IPC] ${tag}:`, msg)
      return onError ? onError(msg) : { success: false, error: msg }
    } finally {
      stop?.()
    }
  })
}
