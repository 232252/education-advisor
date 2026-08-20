// =============================================================
// IPC 客户端封装 — 类型安全的 window.api 调用
// 按域拆分至 ./ipc/ 目录,此处保留聚合入口:
//   getAPI / getErrorMessage 既有导出签名不变
// =============================================================

import { translateEaaError } from './eaa-error-messages'
import type { WindowAPI } from './ipc/window-api'

export type { WindowAPI } from './ipc/window-api'

/** 获取 API 客户端（带安全检查） */
export function getAPI(): WindowAPI {
  if (!window.api) {
    throw new Error('window.api is not available. Are you running inside Electron?')
  }
  return window.api
}

/**
 * 从 EAAResult 中提取最有用的错误信息。
 * TEXT_OUTPUT_COMMANDS 失败时 CLI 详细错误在 data（字符串），
 * JSON 命令失败时在 stderr。按优先级选取。
 *
 * D9 错误可观测性: 选取后经 EAA 错误翻译层处理 —
 * Rust AppError / bridge 层英文错误翻译为当前语言的用户可读提示,
 * 已是中文的消息与未知消息原样透传。
 */
export function getErrorMessage(
  result: { data?: unknown; stderr?: string },
  fallback = '未知错误',
): string {
  let raw = ''
  if (typeof result.data === 'string' && result.data.length > 0) raw = result.data
  else if (result.stderr && result.stderr.length > 0) raw = result.stderr
  if (!raw) return fallback
  return translateEaaError(raw) ?? raw
}
