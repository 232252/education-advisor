// =============================================================
// feishu-bot/http-instance — fetch 版 SDK HttpInstance + 域名 base
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import type { FeishuDomain } from '../feishu/config'

/**
 * fetch-based HTTP 实例,替代 SDK 默认的 axios。
 *
 * 必要性:axios 1.13.x 在 Node 22+/26 上存在兼容性 bug,部分 HTTPS 请求
 * 会返回 400(尤其是飞书长连接 endpoint /callback/ws/endpoint)。Node 内置的
 * fetch 没有此问题。这里实现 SDK 期望的 HttpInstance 接口(7 个方法),
 * 全部用 fetch 绕过 axios。
 */
/**
 * 当前飞书域名 base,由 start() 根据 domain 设置(单例,同一时刻仅一个域名活跃)。
 * fetchRequest / validateCredentials 在调用时读取此值,故 start() 中先赋值再发请求。
 * - feishu: https://open.feishu.cn
 * - lark:   https://open.larksuite.com
 */
let feishuBase = 'https://open.feishu.cn'

/** 设置当前飞书域名 base(由 FeishuBotService.start 在发起任何请求前调用) */
export function setFeishuBase(domain: FeishuDomain): void {
  feishuBase = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
}

/** 读取当前飞书域名 base(直接发 fetch 的调用方使用,如凭证预检) */
export function getFeishuBase(): string {
  return feishuBase
}

interface FetchOpts {
  url?: string
  method?: string
  headers?: Record<string, string>
  data?: unknown
  params?: Record<string, string>
}

async function fetchRequest<T>(opts: FetchOpts): Promise<T> {
  let url = opts.url || ''
  if (!url.startsWith('http')) {
    url = `${feishuBase}${url}`
  }
  if (opts.params) {
    const qs = new URLSearchParams(opts.params).toString()
    url = `${url}${url.includes('?') ? '&' : '?'}${qs}`
  }
  const method = (opts.method || 'get').toUpperCase()
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined,
    signal: AbortSignal.timeout(15000), // 15s 超时,防止飞书服务器无响应时请求无限挂起
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export const fetchHttpInstance = {
  request: <T = unknown>(opts: FetchOpts) => fetchRequest<T>(opts),
  get: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'get' }),
  delete: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'delete' }),
  head: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'head' }),
  options: <T = unknown>(url: string, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'options' }),
  post: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'post', data }),
  put: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'put', data }),
  patch: <T = unknown>(url: string, data?: unknown, opts?: FetchOpts) =>
    fetchRequest<T>({ ...opts, url, method: 'patch', data }),
}
