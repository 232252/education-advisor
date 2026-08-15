// =============================================================
// feishu/diagnose — 网络诊断 — 帮助用户排查飞书远程访问连接问题
// 依次检测: DNS 解析 → HTTPS 连通 → 鉴权 → WebSocket 端点
// 每步返回 pass/fail + 耗时 + 诊断建议
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { type FeishuDomain, getApiBase } from './config'
import type { TenantTokenResponse } from './token'

export interface DiagnoseStep {
  name: string
  status: 'pass' | 'fail' | 'skip'
  latencyMs?: number
  detail: string
  suggestion?: string
}

export interface DiagnoseResult {
  steps: DiagnoseStep[]
  overall: 'pass' | 'fail'
  domain: FeishuDomain
  timestamp: number
}

/**
 * 网络诊断:逐步检测飞书远程访问链路。
 * 用于排查"连接不上"/"长时间连接中"等远程访问问题。
 */
export async function diagnoseConnection(
  appId: string,
  appSecret: string,
  domain: FeishuDomain,
): Promise<DiagnoseResult> {
  const apiBase = getApiBase(domain)
  const hostname = domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'
  const steps: DiagnoseStep[] = []

  // Step 1: DNS 解析
  try {
    const t0 = Date.now()
    const url = new URL(apiBase)
    const resolved = await resolveHostname(url.hostname)
    const latency = Date.now() - t0
    steps.push({
      name: 'DNS 解析',
      status: resolved ? 'pass' : 'fail',
      latencyMs: latency,
      detail: resolved ? `${url.hostname} → ${resolved}` : `${url.hostname} 无法解析`,
      suggestion: resolved
        ? undefined
        : '检查网络 DNS 设置或尝试切换 DNS 服务器(如 8.8.8.8 / 114.114.114.114)',
    })
  } catch (err) {
    steps.push({
      name: 'DNS 解析',
      status: 'fail',
      detail: `DNS 查询异常: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: '检查网络连接或 DNS 配置',
    })
  }

  // Step 2: HTTPS 连通(HEAD 请求测端口 443 可达性)
  try {
    const t0 = Date.now()
    const res = await fetch(`${apiBase}/auth/v3/app/token/internal`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    const latency = Date.now() - t0
    // 飞书对 HEAD 可能返回 405/404,只要 TCP+TLS 握手成功就算连通
    const reachable = res.status < 500
    steps.push({
      name: 'HTTPS 连通',
      status: reachable ? 'pass' : 'fail',
      latencyMs: latency,
      detail: reachable ? `HTTPS 握手成功 (HTTP ${res.status})` : `服务器异常 (HTTP ${res.status})`,
      suggestion: reachable ? undefined : '飞书服务器暂时不可用,请稍后重试',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({
      name: 'HTTPS 连通',
      status: 'fail',
      detail: `无法连接 ${hostname}:443 — ${msg}`,
      suggestion: msg.includes('timeout')
        ? '连接超时:可能被防火墙/代理拦截,请检查网络出站规则或尝试其他网络'
        : msg.includes('ENOTFOUND')
          ? '域名无法解析:请检查 DNS 设置'
          : '检查防火墙是否放行 HTTPS(443)出站,或尝试更换网络环境',
    })
  }

  // Step 3: 鉴权校验
  if (!appId || !appSecret) {
    steps.push({
      name: '凭证校验',
      status: 'skip',
      detail: 'appId 或 appSecret 未配置,跳过鉴权检测',
      suggestion: '请先在设置页填写 App ID 和 App Secret',
    })
  } else {
    try {
      const t0 = Date.now()
      const res = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(10_000),
      })
      const latency = Date.now() - t0
      const data = (await res.json()) as TenantTokenResponse
      if (data.code === 0 && data.tenant_access_token) {
        steps.push({
          name: '凭证校验',
          status: 'pass',
          latencyMs: latency,
          detail: `tenant_access_token 获取成功,有效期 ${data.expire ?? 7200}s`,
        })
      } else {
        steps.push({
          name: '凭证校验',
          status: 'fail',
          latencyMs: latency,
          detail: `鉴权失败 code=${data.code}: ${data.msg}`,
          suggestion: getSuggestionForAuthError(data.code),
        })
      }
    } catch (err) {
      steps.push({
        name: '凭证校验',
        status: 'fail',
        detail: `鉴权请求失败: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: '检查网络连接后重试',
      })
    }
  }

  // Step 4: WebSocket 端点可达性(长连接模式核心)
  try {
    const t0 = Date.now()
    // 飞书长连接端点通过 /callback/ws/endpoint 获取 ticket
    const res = await fetch(`${apiBase}/callback/ws/endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const latency = Date.now() - t0
    // 此端点需要鉴权,未带 token 会返回 401/400/404。
    // 只要服务器有 HTTP 响应(非 5xx),就说明 TCP+TLS 可达,WebSocket 长连接能建立
    const endpointReachable = res.status < 500
    steps.push({
      name: 'WebSocket 端点',
      status: endpointReachable ? 'pass' : 'fail',
      latencyMs: latency,
      detail: endpointReachable
        ? `长连接端点可达 (HTTP ${res.status})`
        : `端点异常 (HTTP ${res.status})`,
      suggestion: endpointReachable ? undefined : '飞书长连接服务暂时不可用,请稍后重试',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({
      name: 'WebSocket 端点',
      status: 'fail',
      detail: `长连接端点不可达: ${msg}`,
      suggestion: msg.includes('timeout')
        ? 'WebSocket 端点连接超时:可能被防火墙拦截 WebSocket(wss)流量,请联系网络管理员放行'
        : '检查网络是否能访问飞书服务器,或尝试更换网络环境(如手机热点)',
    })
  }

  const overall = steps.every((s) => s.status === 'pass' || s.status === 'skip') ? 'pass' : 'fail'

  return {
    steps,
    overall,
    domain,
    timestamp: Date.now(),
  }
}

/** DNS 解析辅助:用 Node 原生 dns.lookup 真实解析,返回 IP 地址(失败返回 null)。
 *  修复:旧实现用 fetch HEAD 探测 + .catch(() => null) 吞掉所有错误,
 *  导致 DNS 失败也永远返回 'resolved'(诊断假阳性,用户无法定位 DNS 问题)。 */
async function resolveHostname(hostname: string): Promise<string | null> {
  try {
    const { lookup } = await import('node:dns/promises')
    const { address } = await lookup(hostname, { verbatim: true })
    return address
  } catch {
    return null
  }
}

/** 根据飞书鉴权错误码给出针对性建议 */
function getSuggestionForAuthError(code: number): string {
  switch (code) {
    case 10001:
      return 'App Secret 不正确,请检查飞书后台的 App Secret 是否与设置页一致'
    case 10002:
      return 'App ID 不正确,请检查飞书后台的 App ID 是否以 cli_ 开头'
    case 10003:
      return '应用已被停用,请在飞书后台重新启用该应用'
    case 10014:
      return 'App Secret 已失效,请在飞书后台重置后更新设置页'
    case 110000:
      return '应用不存在或已被删除,请检查 App ID'
    default:
      return `请检查飞书后台应用配置(错误码 ${code})`
  }
}
