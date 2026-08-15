// =============================================================
// File Tools — 共享辅助: 结果构造
// 从 file-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentToolResult } from '@earendil-works/pi-agent-core'

// 辅助函数
export function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}
