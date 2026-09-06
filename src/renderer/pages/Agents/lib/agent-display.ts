// =============================================================
// Agents 模块纯函数 — 状态推导/格式化/排序（无副作用）
// =============================================================

import type { AgentExecution, AgentStatus } from '@shared/types'
import { t as tf } from '../../../i18n'

/** Agent 状态 → 展示文本（运行中/错误/就绪/已停用） */
export function getAgentStatusLabel(status: AgentStatus, enabled: boolean): string {
  return status === 'running'
    ? tf('agents.status.running', '运行中')
    : status === 'error'
      ? tf('agents.status.error', '错误')
      : enabled
        ? tf('agents.status.ready', '就绪')
        : tf('agents.status.disabled', '已停用')
}

/** 模型档位 → 展示文本 */
export function getModelTierLabel(modelTier: 'high_quality' | 'low_cost'): string {
  return modelTier === 'high_quality'
    ? tf('agents.tier.high', '高质量')
    : tf('agents.tier.low', '低成本')
}

/** 执行历史时间格式化: M/D HH:mm */
/** [R2-21 豁免] 执行历史用紧凑 M/D H:mm(省空间),与展示用 formatDateTime 语义不同 */
export function formatHistoryTime(startedAt: number): string {
  const date = new Date(startedAt)
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 执行历史按开始时间倒序（返回新数组,不修改入参） */
export function sortExecutionsDesc(executions: AgentExecution[]): AgentExecution[] {
  return [...executions].sort((a, b) => b.startedAt - a.startedAt)
}
