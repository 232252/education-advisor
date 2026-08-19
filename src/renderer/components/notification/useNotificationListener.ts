// =============================================================
// useNotificationListener — 通知中心事件监听(挂载一次)
// 数据源:
//   - agent 状态事件(经 agentStore 派生总线 subscribeStatus)
//       · error → 错误通知
//       · idle + result → 成功通知(输出摘要)
//       · idle + aborted → 中止通知
//   - cron 状态事件(cron.onStatusUpdate)
//       · error/timeout → 错误通知
//       · skipped_circuit_breaker → 警告通知
//       · success 且为 __feishu__(bitable 同步,无 agent 事件) → 成功通知
//       · agent 型任务的成功由 agent 事件覆盖,不重复通知
// =============================================================

import type { AgentStatusPayload, CronTask } from '@shared/types'
import { useEffect } from 'react'
import { getAPI } from '../../lib/ipc-client'
import { useAgentStore } from '../../stores/agentStore'
import { useNotificationStore } from '../../stores/notificationStore'

/** cron 任务名解析缓存(60s TTL,任务名变化频率低) */
const CRON_NAME_TTL_MS = 60_000
let cronNameCache: { at: number; names: Map<string, { name: string; agentId: string }> } | null =
  null

/** 测试专用: 清空 cron 名称缓存(模块级缓存跨用例残留) */
export function _resetCronNameCacheForTest(): void {
  cronNameCache = null
}

async function resolveCronTask(
  taskId: string,
): Promise<{ name: string; agentId: string } | undefined> {
  if (!cronNameCache || Date.now() - cronNameCache.at > CRON_NAME_TTL_MS) {
    try {
      const tasks: CronTask[] = await getAPI().cron.list()
      cronNameCache = {
        at: Date.now(),
        names: new Map(tasks.map((t) => [t.id, { name: t.name, agentId: t.agentId }])),
      }
    } catch (err) {
      console.warn('[Notifications] cron list failed:', err)
      cronNameCache = { at: Date.now(), names: new Map() }
    }
  }
  return cronNameCache.names.get(taskId)
}

/** 输出摘要: 去空白后截断 */
function summarize(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function useNotificationListener() {
  useEffect(() => {
    const push = useNotificationStore.getState().push

    // ── Agent 状态事件 ──
    const unsubAgent = useAgentStore.getState().subscribeStatus((data) => {
      const payload = data as AgentStatusPayload
      if (payload.status === 'running') return
      const agent = useAgentStore.getState().agents.find((a) => a.id === payload.agentId) ?? null
      const agentName = agent?.name ?? payload.agentId

      if (payload.status === 'error') {
        push({
          source: 'agent',
          level: 'error',
          title: `Agent 运行失败 — ${agentName}`,
          message: payload.error || summarize(payload.output),
          target: `/agents?agent_id=${encodeURIComponent(payload.agentId)}`,
        })
        return
      }
      // status === 'idle' (执行结束)
      if (payload.aborted) {
        push({
          source: 'agent',
          level: 'info',
          title: `Agent 已中止 — ${agentName}`,
          target: `/agents?agent_id=${encodeURIComponent(payload.agentId)}`,
        })
        return
      }
      if (payload.result) {
        push({
          source: 'agent',
          level: payload.result.status === 'success' ? 'success' : 'error',
          title: `Agent 运行完成 — ${agentName}`,
          message: summarize(payload.result.output),
          target: `/agents?agent_id=${encodeURIComponent(payload.agentId)}`,
        })
      }
    })

    // ── Cron 状态事件 ──
    let unsubCron: (() => void) | null = null
    try {
      unsubCron = getAPI().cron.onStatusUpdate((raw) => {
        const data = raw as { taskId: string; lastStatus?: string }
        if (!data?.taskId) return
        const status = data.lastStatus
        void (async () => {
          const task = await resolveCronTask(data.taskId)
          const taskName = task?.name ?? data.taskId
          if (status === 'error' || status === 'timeout') {
            push({
              source: 'cron',
              level: 'error',
              title: `定时任务失败 — ${taskName}`,
              target: '/scheduler',
            })
          } else if (status === 'skipped_circuit_breaker') {
            push({
              source: 'cron',
              level: 'warning',
              title: `定时任务被熔断跳过 — ${taskName}`,
              message: '连续配额错误,已暂停自动执行;可手动运行或重启任务重置',
              target: '/scheduler',
            })
          } else if (status === 'success' && task?.agentId === '__feishu__') {
            push({
              source: 'cron',
              level: 'success',
              title: `飞书同步完成 — ${taskName}`,
              target: '/scheduler',
            })
          }
        })()
      })
    } catch (err) {
      console.warn('[Notifications] cron listener init failed:', err)
    }

    return () => {
      unsubAgent()
      unsubCron?.()
    }
  }, [])
}
