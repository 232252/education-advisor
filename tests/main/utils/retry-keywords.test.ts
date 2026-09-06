// =============================================================
// retry-keywords 测试 — 配额/不可重试关键词表语义基线
// (cron 熔断与 agent 续跑共享同一来源,锁定超集关系与中文词覆盖)
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  matchesAnyKeyword,
  NON_RETRYABLE_KEYWORDS,
  QUOTA_ERROR_KEYWORDS,
} from '../../../src/main/utils/retry-keywords'

describe('retry-keywords', () => {
  it('配额类: 429/rate limit/quota/中文词全部命中(大小写不敏感)', () => {
    for (const msg of ['HTTP 429 Too Many Requests', 'Rate_Limit exceeded', 'quota exceeded', '已达用量上限', '触发配额限制']) {
      expect(matchesAnyKeyword(msg.toLowerCase(), QUOTA_ERROR_KEYWORDS)).toBe(true)
    }
    expect(matchesAnyKeyword('', QUOTA_ERROR_KEYWORDS)).toBe(false)
    expect(matchesAnyKeyword('network timeout'.toLowerCase(), QUOTA_ERROR_KEYWORDS)).toBe(false)
  })

  it('不可重试表是配额表的严格超集(含鉴权词)', () => {
    for (const q of QUOTA_ERROR_KEYWORDS) {
      expect(NON_RETRYABLE_KEYWORDS).toContain(q)
    }
    for (const auth of ['401', '403', 'unauthorized', 'invalid api key']) {
      expect(NON_RETRYABLE_KEYWORDS).toContain(auth)
    }
  })
})
