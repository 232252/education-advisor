// =============================================================
// IPC 客户端封装 — 类型安全的 window.api 调用
// 按域拆分至 ./ipc/ 目录,此处保留聚合入口:
//   getAPI / getErrorMessage 既有导出签名不变
// =============================================================

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
 */
export function getErrorMessage(
  result: { data?: unknown; stderr?: string },
  fallback = '未知错误',
): string {
  if (typeof result.data === 'string' && result.data.length > 0) return result.data
  if (result.stderr && result.stderr.length > 0) return result.stderr
  return fallback
}
