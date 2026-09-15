// =============================================================
// adapters/_shared/bot-http — 海外 Bot 薄客户端共用 HTTP 助手
// =============================================================

export function outboundText(content: { text: string }): string {
  return content.text
}

export async function jsonFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const { timeoutMs = 20_000, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/** 可选代理字段仅作 UI/状态提示(原生 fetch 不自动走 HTTP 代理) */
export function proxyHint(proxyUrl: string | undefined): string | undefined {
  const p = (proxyUrl ?? '').trim()
  if (!p) return undefined
  return `已配置 proxyUrl=${p}；请确保系统/环境代理可达目标 API`
}
