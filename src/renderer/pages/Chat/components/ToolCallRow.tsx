// =============================================================
// 工具调用展示块 — 消息气泡顶部的工具名/参数/结果状态
// =============================================================

import type { ToolCall } from '@shared/types'

/** 单条工具调用行：工具名 + 参数 JSON + 成功/失败标记 */
export function ToolCallRow({ tc }: { tc: ToolCall }) {
  return (
    <div className="text-xs bg-blue-100/50 dark:bg-blue-900/30 rounded px-2 py-1 font-mono">
      <span className="text-blue-600 dark:text-blue-400 font-medium">{tc.name}</span>
      {tc.args && Object.keys(tc.args).length > 0 && (
        <span className="text-gray-500 dark:text-gray-400 ml-1">{JSON.stringify(tc.args)}</span>
      )}
      {tc.result && (
        <span
          className={`ml-1 ${tc.isError ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}
        >
          {tc.isError ? '✗' : '✓'}
        </span>
      )}
    </div>
  )
}
