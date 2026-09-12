// =============================================================
// Agent 状态事件派发（从 agent-service.ts 抽出，纯重构零行为变化）
// M0 新增: 运行来源(source)登记表 — sendAgentStatus 自动把当前
// 运行的 source 盖进负载,渲染层据此过滤 channel/cron 运行,
// abortAgent 据此做来源隔离(不误杀频道触发的运行)。
// 同一 agent 的运行被 AgentRunQueue 串行化,登记/清理包住整次
// 运行,不会读到别的执行的来源。
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { AgentRunSource, AgentStatus, AgentStatusPayload } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { sendToRenderer } from '../../ipc/broadcast'
import { agentEvents } from './agent-events'

const activeRunSources = new Map<string, AgentRunSource>()

/** 标记某 agent 当前运行的来源(executeAgentRun 开始时调用) */
export function setActiveRunSource(agentId: string, source: AgentRunSource): void {
  activeRunSources.set(agentId, source)
}

/** 清除来源登记(executeAgentRun finally 中调用) */
export function clearActiveRunSource(agentId: string): void {
  activeRunSources.delete(agentId)
}

/** 读取当前来源;无登记(无在途运行/历史事件)时按 'ui' 兜底(向后兼容) */
export function getActiveRunSource(agentId: string): AgentRunSource {
  return activeRunSources.get(agentId) ?? 'ui'
}

/** 统一发送 agent 状态更新到渲染进程
 *  F4 修复: 负载统一为 shared/types/agent.ts 的 AgentStatusPayload 契约。
 *  extras 参数保持 Record<string, unknown>(agent-service.sendStatus 透传),
 *  发送前收窄为 AgentStatusPayload,与 renderer stores 的 AgentStatusUpdate 对齐。
 *  extras 里显式传入的 source 优先于登记表(abortAgent 发 idle 时运行可能已清理)。 */
export function sendAgentStatus(
  win: BrowserWindow | undefined,
  agentId: string,
  status: AgentStatus,
  extras: Record<string, unknown> = {},
): void {
  const payload = {
    agentId,
    status,
    source: getActiveRunSource(agentId),
    ...extras,
  } as AgentStatusPayload
  try {
    sendToRenderer(win, IPC.IPC_AGENT_STATUS_UPDATE, payload)
  } catch (err) {
    console.warn(`[AgentService] Failed to send status for ${agentId}:`, err)
  }
  // 进程内镜像:飞书频道等非 UI 消费方订阅流式增量(见 agent-events.ts)
  try {
    agentEvents.emit('status', payload)
  } catch {
    /* 订阅方异常不影响主流程 */
  }
}
