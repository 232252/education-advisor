// =============================================================
// 定时任务类型
// =============================================================

export interface CronTask {
  id: string
  name: string
  agentId: string
  expression: string
  prompt: string
  enabled: boolean
  modelTier: 'high_quality' | 'low_cost'
  lastRunAt?: number
  /** R57-3 H3: 新增 skipped_concurrent_limit; R57-3 H1: 新增 pending(恢复时初始态)
   *  circuit-breaker: 连续配额类错误(429/quota)熔断后,cron 触发被跳过
   *  F2 修复: 新增 skipped — bitableSync 返回 skipped 字段(如开关已关闭)不算 error */
  lastStatus?:
    | 'success'
    | 'error'
    | 'timeout'
    | 'skipped'
    | 'skipped_concurrent_limit'
    | 'skipped_circuit_breaker'
    | 'pending'
  nextRunAt?: number
}

export interface CronLogEntry {
  taskId: string
  agentId: string
  timestamp: number
  durationMs: number
  /** R57-3 H3: 新增 skipped_concurrent_limit(并发上限跳过时记录)
   *  circuit-breaker: 熔断跳过时记录
   *  F2 修复: 新增 skipped — bitableSync 返回 skipped 字段时记录(不算 error)
   *  M35: 新增 skipped_missed — 错过调度补偿(系统睡眠/事件循环阻塞导致应跑槽位整体
   *  被错过,补跑一次前先记录该槽位丢失) */
  status:
    | 'success'
    | 'error'
    | 'timeout'
    | 'skipped'
    | 'skipped_concurrent_limit'
    | 'skipped_circuit_breaker'
    | 'skipped_missed'
  error?: string
}
