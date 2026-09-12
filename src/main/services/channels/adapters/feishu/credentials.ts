// =============================================================
// adapters/feishu/credentials — 启动前凭证预检(防"假连接")
// (M3 从 feishu-bot/credentials.ts 搬入,不变;原文件改为 re-export 壳)
// =============================================================

import { errText } from '../../../../utils/err-text'
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
    // 凭据去首尾空白: 粘贴带入的空格/换行会让飞书返回 10003/10014 鉴权失败
    const res = await fetch(`${getFeishuBase()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId.trim(), app_secret: appSecret.trim() }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as { code?: number; msg?: string }
    if (data.code === 0) return null
    return `appId/appSecret 校验失败(code=${data.code}): ${data.msg ?? '未知错误'}`
  } catch (err) {
    return `凭证校验请求失败: ${errText(err)}`
  }
}
