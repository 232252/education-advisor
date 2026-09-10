// =============================================================
// Agent 状态事件派发（从 agent-service.ts 抽出，纯重构零行为变化）
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { AgentStatus, AgentStatusPayload } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { sendToRenderer } from '../../ipc/broadcast'

/** 统一发送 agent 状态更新到渲染进程
 *  F4 修复: 负载统一为 shared/types/agent.ts 的 AgentStatusPayload 契约。
 *  extras 参数保持 Record<string, unknown>(agent-service.sendStatus 透传),
 *  发送前收窄为 AgentStatusPayload,与 renderer stores 的 AgentStatusUpdate 对齐。 */
export function sendAgentStatus(
  win: BrowserWindow | undefined,
  agentId: string,
  status: AgentStatus,
  extras: Record<string, unknown> = {},
): void {
  const payload = { agentId, status, ...extras } as AgentStatusPayload
  try {
    sendToRenderer(win, IPC.IPC_AGENT_STATUS_UPDATE, payload)
  } catch (err) {
    console.warn(`[AgentService] Failed to send status for ${agentId}:`, err)
  }
}
