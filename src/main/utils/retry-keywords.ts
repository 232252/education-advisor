// =============================================================
// retry-keywords — 错误分类关键词表(单一来源)
// cron 熔断(isQuotaError)与 agent 续跑(isNonRetryableError)原先各自
// 手抄一份关键词表,注释宣称"对齐"实际已漂移(cron 多中文词、缺鉴权词)。
// 现共享同一常量: 非重试表 = 配额表 + 鉴权类(严格超集,语义即如此)。
// 匹配规则: 小写化子串包含(与两处原实现一致)。
// =============================================================

/** 配额/限流类: 持续会失败,值得熔断 */
export const QUOTA_ERROR_KEYWORDS: readonly string[] = [
  '429',
  'rate_limit',
  'rate limit',
  'too many requests',
  'quota',
  '用量上限',
  '配额',
]

/** 不可重试类: 配额超集 + 鉴权/授权失败 */
export const NON_RETRYABLE_KEYWORDS: readonly string[] = [
  ...QUOTA_ERROR_KEYWORDS,
  '401',
  '403',
  'unauthorized',
  'forbidden',
  'authentication failed',
  'invalid api key',
]

export function matchesAnyKeyword(lowerMsg: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => lowerMsg.includes(k))
}
