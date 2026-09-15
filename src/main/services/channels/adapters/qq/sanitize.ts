// =============================================================
// adapters/qq/sanitize — QQ 出站文本 URL 清洗(QwenPaw _sanitize_qq_text)
// QQ API 不允许纯文本消息含链接
// =============================================================

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi

/** 更激进:裸域名如 example.com / 12306.cn */
const BARE_DOMAIN_PATTERN =
  /https?:\/\/[^\s]+|www\.[^\s]+|\b[\w][\w.-]*\.(?:com|cn|org|net|edu|gov|io|co|cc|tv|me|info|biz|app|dev|top|xyz|site|vip|shop|tech|club|pro|live|mobi|asia|wiki)(?:\.[a-z]{2,3})?\b(?:\/[^\s]*)?/gi

const REPLACEMENT = '[链接已省略]'

export function sanitizeQqText(text: string): { text: string; hadUrl: boolean } {
  if (!text) return { text: '', hadUrl: false }
  let count = 0
  const sanitized = text.replace(URL_PATTERN, () => {
    count++
    return REPLACEMENT
  })
  return { text: sanitized, hadUrl: count > 0 }
}

export function aggressiveSanitizeQqText(text: string): { text: string; hadUrl: boolean } {
  if (!text) return { text: '', hadUrl: false }
  let count = 0
  const sanitized = text.replace(BARE_DOMAIN_PATTERN, () => {
    count++
    return REPLACEMENT
  })
  return { text: sanitized, hadUrl: count > 0 }
}

/** QQ 因含 URL 拒信(304003 / 40034028 / 不允许包含url) */
export function isQqUrlContentError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase()
  return (
    msg.includes('304003') ||
    msg.includes('40034028') ||
    msg.includes('不允许包含url') ||
    (msg.includes('not allow') && msg.includes('url'))
  )
}
