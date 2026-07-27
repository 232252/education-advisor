// =============================================================
// Feishu Service — 飞书开放平台集成 (基于官方 Open API)
// 实现:
//   - tenant_access_token 鉴权(POST /open-apis/auth/v3/tenant_access_token/internal)
//   - 测连接(testConnection)
//   - bitable 列表(listBitableTables)
//   - 发文本消息(sendTextMessage)
// 设计参考: OpenClaw 飞书插件的鉴权 + 直发模式
// =============================================================

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

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
let cachedToken: { token: string; expireAt: number; appId: string } | null = null

/**
 * M-6 修复: 正在进行中的 token 获取 Promise + 对应的 appId。
 * 多个并发 getTenantToken 调用同一 appId 时复用同一个 in-flight Promise,
 * 避免竞态:多个调用同时发现 cachedToken 为 null 并各自发起 fetch。
 * 不同 appId 的调用不共享 in-flight Promise。
 */
let tokenFetchInFlight: {
  appId: string
  promise: Promise<{ token: string; expireSec: number }>
} | null = null

/** 内部:获取 tenant_access_token,自动缓存到过期前 5 分钟 */
async function getTenantToken(
  appId: string,
  appSecret: string,
): Promise<{ token: string; expireSec: number }> {
  // 命中缓存: 必须同时满足 appId 一致 + 未过期(距过期 >5 分钟)
  if (
    cachedToken &&
    cachedToken.appId === appId &&
    cachedToken.expireAt > Date.now() + 5 * 60 * 1000
  ) {
    return {
      token: cachedToken.token,
      expireSec: Math.floor((cachedToken.expireAt - Date.now()) / 1000),
    }
  }
  // M-6 修复: 如果同一 appId 已有 in-flight Promise,复用它(避免并发重复获取 token)
  if (tokenFetchInFlight && tokenFetchInFlight.appId === appId) {
    console.log('[Feishu] Reusing in-flight token fetch')
    await tokenFetchInFlight.promise
    // in-flight 完成后 cachedToken 已被设置,从缓存读取
    if (cachedToken && cachedToken.appId === appId && cachedToken.expireAt > Date.now()) {
      return {
        token: cachedToken.token,
        expireSec: Math.floor((cachedToken.expireAt - Date.now()) / 1000),
      }
    }
    // 缓存仍未命中(不太可能),继续走正常 fetch 路径
  }
  // M-6 修复: 创建新的 in-flight Promise,仅对同一 appId 去重
  const promise = (async () => {
    const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
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
    }
    return { token: data.tenant_access_token, expireSec: data.expire ?? 7200 }
  })().finally(() => {
    tokenFetchInFlight = null
  })
  tokenFetchInFlight = { appId, promise }
  return promise
}

/** 测试连接:用 appId/secret 拿 token,返回 token + 过期秒数 */
export async function testConnection(
  appId: string,
  appSecret: string,
): Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }> {
  try {
    // M-6 修复: 强制刷新时同时清除缓存和 in-flight 引用,确保拿全新 token
    cachedToken = null
    tokenFetchInFlight = null
    const { token, expireSec } = await getTenantToken(appId, appSecret)
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
): Promise<{ success: boolean; tables?: BitableTable[]; error?: string }> {
  try {
    // MEDIUM 修复: 校验 appToken,防止 URL 路径注入
    validateToken(appToken, 'appToken')
    const { token } = await getTenantToken(appId, appSecret)
    const res = await fetch(`${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables`, {
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
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { token } = await getTenantToken(appId, appSecret)
    const res = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=open_id`, {
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
): Promise<{ success: boolean; recordId?: string; error?: string }> {
  try {
    // MEDIUM 修复: 校验 appToken 和 tableId,防止 URL 路径注入
    validateToken(appToken, 'appToken')
    validateToken(tableId, 'tableId')
    const { token } = await getTenantToken(appId, appSecret)
    const res = await fetch(
      `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
      },
    )
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
): Promise<{ success: boolean; skipped?: string; recordId?: string; error?: string }> {
  if (!appId || !appSecret) {
    return { success: false, skipped: 'feishu credentials not configured' }
  }
  if (!appToken || !tableId) {
    return { success: false, skipped: 'bitable app_token/table_id not configured' }
  }
  return addBitableRecord(appId, appSecret, appToken, tableId, fields)
}
