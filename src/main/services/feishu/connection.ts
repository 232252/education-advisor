// =============================================================
// feishu/connection — 测试连接(testConnection)
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import type { FeishuDomain } from './config'
import { clearTokenCache, getTenantToken } from './token'

/** 测试连接:用 appId/secret 拿 token,返回 token + 过期秒数 */
export async function testConnection(
  appId: string,
  appSecret: string,
  domain: FeishuDomain,
): Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }> {
  try {
    // M-6 修复: 强制刷新时同时清除缓存和 in-flight 引用,确保拿全新 token
    clearTokenCache()
    const { token, expireSec } = await getTenantToken(appId, appSecret, domain)
    return { success: true, token: `${token.slice(0, 8)}...`, expireSec }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
