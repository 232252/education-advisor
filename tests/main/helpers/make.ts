// =============================================================
// 主进程测试数据工厂 — 此前 cron/agent 测试各抄一份
// =============================================================

import { vi } from 'vitest'
import type { AgentExecution } from '@shared/types'

/** AgentExecution 假对象(cron 执行路径/委托工具断言用) */
export function makeExecution(
  agentId: string,
  status: AgentExecution['status'] = 'success',
  output = 'ok',
): AgentExecution {
  return {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    prompt: 'x',
    output,
    startedAt: Date.now(),
    durationMs: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: 0,
    status,
  }
}

/** 构造 fetch Response 形状的 mock 返回值 */
export function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}
