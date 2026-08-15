// =============================================================
// feishu-bot/credentials — 启动前凭证预检(防"假连接")
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { getFeishuBase } from './http-instance'

/**
 * H1 修复: 启动前校验 appId/appSecret 是否有效(请求 tenant_access_token)。
 * SDK 的 WSClient 对非法凭证只会在后台无限重试,状态永远停在"连接中"(假连接)。
 * 这里先做一次显式鉴权,失败立即给出明确错误。返回 null 表示凭证有效。
 */
export async function validateCredentials(
  appId: string,
  appSecret: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${getFeishuBase()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as { code?: number; msg?: string }
    if (data.code === 0) return null
    return `appId/appSecret 校验失败(code=${data.code}): ${data.msg ?? '未知错误'}`
  } catch (err) {
    return `凭证校验请求失败: ${err instanceof Error ? err.message : String(err)}`
  }
}
