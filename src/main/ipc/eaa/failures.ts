// =============================================================
// EAA IPC — 统一失败信封
// eaa 各 handler catch 块共用的 { success:false, error, stderr, exitCode:-1 } 构造
// =============================================================

import { errText } from '../../utils/err-text'

/**
 * 构造 EAA 域 IPC 失败返回并打错误日志(异常路径)。
 * @param label 日志前缀(如 'eaa:summary'),日志格式 `[IPC] <label> failed: <msg>`
 */
export function eaaFailure(label: string, err: unknown) {
  const msg = errText(err)
  console.error(`[IPC] ${label} failed:`, msg)
  return { success: false, error: msg, stderr: msg, exitCode: -1 }
}

/** 构造 EAA 域 IPC 校验失败返回(纯信封,不打日志,消息原样透传) */
export function eaaReject(message: string) {
  return { success: false, error: message, stderr: message, exitCode: -1 }
}
