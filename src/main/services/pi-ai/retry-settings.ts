// =============================================================
// retry-settings — models.retry.* 配置读取
//
// Chat(streaming.ts)与 Agent(retrying-stream.ts)两条流式链路共用,
// 保证重试口径一致。逐字段 typeof 守卫:settings 被手改成错误类型时
// 回退到该字段的默认值而不是整个读取失败。
// =============================================================

import { settingsService } from '../settings-service'

interface RetrySettings {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
  providerTimeoutMs: number
}

/**
 * 读取 models.retry.*。settings 读取本身抛错时向上传播,
 * 由调用方决定降级方式(Chat 打 warn / Agent 静默用默认值)。
 * 默认值:enabled=true / maxRetries=3 / baseDelayMs=1000 / providerTimeoutMs=60000
 */
export function readRetrySettings(): RetrySettings {
  const s: RetrySettings = {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1000,
    providerTimeoutMs: 60000,
  }
  const r = settingsService.getSettings().models?.retry
  if (r) {
    if (typeof r.enabled === 'boolean') s.enabled = r.enabled
    if (typeof r.maxRetries === 'number' && r.maxRetries >= 0) s.maxRetries = r.maxRetries
    if (typeof r.baseDelayMs === 'number' && r.baseDelayMs > 0) s.baseDelayMs = r.baseDelayMs
    if (typeof r.providerTimeoutMs === 'number' && r.providerTimeoutMs > 0) {
      s.providerTimeoutMs = r.providerTimeoutMs
    }
  }
  return s
}
