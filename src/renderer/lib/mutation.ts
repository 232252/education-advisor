// =============================================================
// mutation — 渲染层 IPC mutation 统一骨架
//
// 收口各 hook/页面反复手写的:
//   try → result.success ? onOk : toast.error(result.error || failMsg)
//      → catch → toast.error(errText(err))
// 可选扩展(2026-09-05 mutation 收口轮,均默认关闭、行为不变):
//   failMsg 传函数 → 完全自定义失败文案(收 `${prefix}: ${error}` 插值族)
//   catchMsg      → 自定义 catch 文案(默认仍 errText;固定串=固定文案)
//   catchLog      → catch 时 console.error(label, err)(保留原日志)
//   setBusy       → busy 孪生: 调用前置 true,finally 置 false
// 仍不适配的形态(多段业务校验/局部控制流)保持手写。
// =============================================================

import { toast } from '../stores/toastStore'
import { errText } from './ipc-client'

/** 标准 IPC 结果信封(success/error) */
interface IpcResult {
  success: boolean
  error?: string
}

export interface RunIpcMutationOpts<T extends IpcResult> {
  /** 失败文案: 字符串=兜底(result.error 优先);函数=完全自定义(收到整个 result) */
  failMsg?: string | ((result: T) => string)
  /** 信封失败时 console.error 的标签(日志参数为 result.error,如 '[Scope] rejected:') */
  failLog?: string
  /** 成功回调(toast.success / 刷新列表 / 清理状态等);返回值忽略(toast.* 返回 id) */
  onOk?: (result: T) => unknown
  /** catch 文案: 缺省=errText(err);字符串=固定文案;函数=完全自定义 */
  catchMsg?: string | ((err: unknown) => string)
  /** catch 时 console.error 的标签(如 '[Scope] label failed:') */
  catchLog?: string
  /** busy 孪生: 调用前置 true,结束(成败皆)置 false */
  setBusy?: (v: boolean) => void
}

/**
 * 执行一次 IPC mutation 并统一处理成功/失败/异常 toast。
 * @param action  IPC 调用(返回标准信封)
 * @returns 是否成功(便于调用方在需要时分支)
 */
export async function runIpcMutation<T extends IpcResult>(
  action: () => Promise<T>,
  opts: RunIpcMutationOpts<T> = {},
): Promise<boolean> {
  const { failMsg, failLog, onOk, catchMsg, catchLog, setBusy } = opts
  setBusy?.(true)
  try {
    const result = await action()
    if (result.success) {
      await onOk?.(result)
      return true
    }
    if (failLog) console.error(failLog, result.error)
    toast.error(typeof failMsg === 'function' ? failMsg(result) : result.error || failMsg || '')
    return false
  } catch (err) {
    if (catchLog) console.error(catchLog, err)
    toast.error(
      catchMsg === undefined
        ? errText(err)
        : typeof catchMsg === 'function'
          ? catchMsg(err)
          : catchMsg,
    )
    return false
  } finally {
    setBusy?.(false)
  }
}
