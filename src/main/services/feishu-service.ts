// =============================================================
// Feishu Service — 飞书开放平台集成 (基于官方 Open API)
// 实现:
//   - tenant_access_token 鉴权(POST /open-apis/auth/v3/tenant_access_token/internal)
//   - 测连接(testConnection)
//   - bitable 列表(listBitableTables)
//   - 发文本消息(sendTextMessage)
// 设计参考: OpenClaw 飞书插件的鉴权 + 直发模式
// =============================================================

/** 飞书域名版本: 'feishu' 国内版 / 'lark' 国际版 */
export type FeishuDomain = 'feishu' | 'lark'

/**
 * 根据域名版本返回 Open API base。
 * - feishu: 国内版 https://open.feishu.cn/open-apis
 * - lark:   国际版 https://open.larksuite.com/open-apis
 */
function getApiBase(domain: FeishuDomain): string {
  return domain === 'lark'
    ? 'https://open.larksuite.com/open-apis'
    : 'https://open.feishu.cn/open-apis'
}

/** fetch 超时上限,防止 DNS 失败或服务器 hang 导致无限等待 */
const FEISHU_FETCH_TIMEOUT_MS = 15_000

interface TenantTokenResponse {
  code: number
  msg: string
  tenant_access_token?: string
  expire?: number
}

interface BitableTable {
  table_id: string
  name: string
}

interface BitableListResponse {
  code: number
  msg: string
  data?: { items?: BitableTable[] }
}

interface MessageResponse {
  code: number
  msg: string
  data?: { message_id?: string }
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
async function getTenantToken(
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

/** 测试连接:用 appId/secret 拿 token,返回 token + 过期秒数 */
export async function testConnection(
  appId: string,
  appSecret: string,
  domain: FeishuDomain,
): Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }> {
  try {
    // M-6 修复: 强制刷新时同时清除缓存和 in-flight 引用,确保拿全新 token
    cachedToken = null
    tokenFetchInFlight = null
    const { token, expireSec } = await getTenantToken(appId, appSecret, domain)
    return { success: true, token: `${token.slice(0, 8)}...`, expireSec }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** MEDIUM 修复: 校验 token 格式,防止 URL 路径注入(如 ../ 或 / 等) */
function validateToken(token: unknown, name: string): void {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error(`Invalid ${name}: expected non-empty alphanumeric string (max 256 chars)`)
  }
}

/** 列出某 bitable app 下的所有表 */
export async function listBitableTables(
  appId: string,
  appSecret: string,
  appToken: string,
  domain: FeishuDomain,
): Promise<{ success: boolean; tables?: BitableTable[]; error?: string }> {
  try {
    // MEDIUM 修复: 校验 appToken,防止 URL 路径注入
    validateToken(appToken, 'appToken')
    const { token } = await getTenantToken(appId, appSecret, domain)
    const apiBase = getApiBase(domain)
    const res = await fetch(`${apiBase}/bitable/v1/apps/${appToken}/tables`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as BitableListResponse
    if (data.code !== 0) {
      return { success: false, error: `code=${data.code} msg=${data.msg}` }
    }
    return { success: true, tables: data.data?.items ?? [] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 给 userOpenId 发文本消息 */
export async function sendTextMessage(
  appId: string,
  appSecret: string,
  userOpenId: string,
  text: string,
  domain: FeishuDomain,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { token } = await getTenantToken(appId, appSecret, domain)
    const apiBase = getApiBase(domain)
    const res = await fetch(`${apiBase}/im/v1/messages?receive_id_type=open_id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: userOpenId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as MessageResponse
    if (data.code !== 0) {
      return { success: false, error: `code=${data.code} msg=${data.msg}` }
    }
    return { success: true, messageId: data.data?.message_id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 内部诊断日志 */
export function feishuInfo(): string {
  return cachedToken
    ? `token cached, expires in ${Math.floor((cachedToken.expireAt - Date.now()) / 1000)}s`
    : 'no cached token'
}

/** T4: 往 bitable 写一条记录 */
export async function addBitableRecord(
  appId: string,
  appSecret: string,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
  domain: FeishuDomain,
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    // MEDIUM 修复: 校验 appToken 和 tableId,防止 URL 路径注入
    validateToken(appToken, 'appToken')
    validateToken(tableId, 'tableId')
    const { token } = await getTenantToken(appId, appSecret, domain)
    const apiBase = getApiBase(domain)
    const res = await fetch(`${apiBase}/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    })
    const data = (await res.json()) as {
      code: number
      msg: string
      data?: { record?: { record_id?: string } }
    }
    if (data.code !== 0) {
      return { success: false, error: `code=${data.code} msg=${data.msg}` }
    }
    return { success: true, recordId: data.data?.record?.record_id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** T4: 手动触发一次 bitable 同步(graceful 降级) */
export async function syncBitableNow(
  appId: string,
  appSecret: string,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
  domain: FeishuDomain,
): Promise<{ success: boolean; skipped?: string; recordId?: string; error?: string }> {
  if (!appId || !appSecret) {
    return { success: false, skipped: 'feishu credentials not configured' }
  }
  if (!appToken || !tableId) {
    return { success: false, skipped: 'bitable app_token/table_id not configured' }
  }
  return addBitableRecord(appId, appSecret, appToken, tableId, fields, domain)
}

// =============================================================
// 网络诊断 — 帮助用户排查飞书远程访问连接问题
// 依次检测: DNS 解析 → HTTPS 连通 → 鉴权 → WebSocket 端点
// 每步返回 pass/fail + 耗时 + 诊断建议
// =============================================================

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
