// =============================================================
// feishu/token — tenant_access_token 获取与缓存(M-3/M-6 修复)
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { FEISHU_FETCH_TIMEOUT_MS, type FeishuDomain, getApiBase } from './config'

interface TenantTokenResponse {
  code: number
  msg: string
  tenant_access_token?: string
  expire?: number
}

// M-3 修复: cachedToken 加入 appId,防止切换凭证后返回旧 app 的 token(跨凭证污染)
// 同时加入 domain,防止切换国内/国际版后返回旧域名的 token(跨域名污染)
let cachedToken: { token: string; expireAt: number; appId: string; domain: FeishuDomain } | null =
  null

/**
 * M-6 修复: 正在进行中的 token 获取 Promise + 对应的 appId。
 * 多个并发 getTenantToken 调用同一 appId 时复用同一个 in-flight Promise,
 * 避免竞态:多个调用同时发现 cachedToken 为 null 并各自发起 fetch。
 * 不同 appId 的调用不共享 in-flight Promise。
 */
let tokenFetchInFlight: {
  appId: string
  domain: FeishuDomain
  promise: Promise<{ token: string; expireSec: number }>
} | null = null

/** 内部:获取 tenant_access_token,自动缓存到过期前 5 分钟 */
export async function getTenantToken(
  appId: string,
  appSecret: string,
  domain: FeishuDomain,
): Promise<{ token: string; expireSec: number }> {
  // 命中缓存: 必须同时满足 appId 一致 + domain 一致 + 未过期(距过期 >5 分钟)
  if (
    cachedToken &&
    cachedToken.appId === appId &&
    cachedToken.domain === domain &&
    cachedToken.expireAt > Date.now() + 5 * 60 * 1000
  ) {
    return {
      token: cachedToken.token,
      expireSec: Math.floor((cachedToken.expireAt - Date.now()) / 1000),
    }
  }
  // M-6 修复: 如果同一 appId + domain 已有 in-flight Promise,复用它(避免并发重复获取 token)
  if (
    tokenFetchInFlight &&
    tokenFetchInFlight.appId === appId &&
    tokenFetchInFlight.domain === domain
  ) {
    console.log('[Feishu] Reusing in-flight token fetch')
    await tokenFetchInFlight.promise
    // in-flight 完成后 cachedToken 已被设置,从缓存读取
    if (
      cachedToken &&
      cachedToken.appId === appId &&
      cachedToken.domain === domain &&
      cachedToken.expireAt > Date.now()
    ) {
      return {
        token: cachedToken.token,
        expireSec: Math.floor((cachedToken.expireAt - Date.now()) / 1000),
      }
    }
    // 缓存仍未命中(不太可能),继续走正常 fetch 路径
  }
  // M-6 修复: 创建新的 in-flight Promise,仅对同一 appId+domain 去重
  const promise = (async () => {
    const apiBase = getApiBase(domain)
    const res = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as TenantTokenResponse
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu auth failed: code=${data.code} msg=${data.msg}`)
    }
    cachedToken = {
      token: data.tenant_access_token,
      expireAt: Date.now() + (data.expire ?? 7200) * 1000,
      appId,
      domain,
    }
    return { token: data.tenant_access_token, expireSec: data.expire ?? 7200 }
  })().finally(() => {
    tokenFetchInFlight = null
  })
  tokenFetchInFlight = { appId, domain, promise }
  return promise
}

/** M-6 修复: 强制刷新时同时清除缓存和 in-flight 引用,确保拿全新 token */
export function clearTokenCache(): void {
  cachedToken = null
  tokenFetchInFlight = null
}

/** 内部诊断日志 */
export function feishuInfo(): string {
  return cachedToken
    ? `token cached, expires in ${Math.floor((cachedToken.expireAt - Date.now()) / 1000)}s`
    : 'no cached token'
}

export type { TenantTokenResponse }
