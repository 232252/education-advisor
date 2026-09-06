// =============================================================
// feishu/request — 飞书开放平台 API 请求公共骨架
// tenant token 获取 → Bearer 鉴权请求 → code!==0 抛错;
// messages / bitable 共用,网络与超时异常原样上抛,由调用方 catch 转失败信封
// =============================================================

import { FEISHU_FETCH_TIMEOUT_MS, type FeishuDomain, getApiBase } from './config'
import { getTenantToken } from './token'

export async function feishuApiRequest<T>(opts: {
  appId: string
  appSecret: string
  domain: FeishuDomain
  /** 以 / 开头的 API 路径(如 /im/v1/messages) */
  path: string
  /** 传入即按 POST + JSON body 发送;省略则 GET */
  body?: unknown
}): Promise<T> {
  const { token } = await getTenantToken(opts.appId, opts.appSecret, opts.domain)
  const res = await fetch(`${getApiBase(opts.domain)}${opts.path}`, {
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
  })
  const data = (await res.json()) as T & { code: number; msg: string }
  if (data.code !== 0) {
    throw new Error(`code=${data.code} msg=${data.msg}`)
  }
  return data
}
