// =============================================================
// feishu/bitable — bitable 表列表 / 记录写入 / 手动同步(T4)
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { errText } from '../../utils/err-text'
import type { FeishuDomain } from './config'
import { feishuApiRequest } from './request'

interface BitableTable {
  table_id: string
  name: string
}

interface BitableListResponse {
  code: number
  msg: string
  data?: { items?: BitableTable[] }
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
    const data = await feishuApiRequest<BitableListResponse>({
      appId,
      appSecret,
      domain,
      path: `/bitable/v1/apps/${appToken}/tables`,
    })
    return { success: true, tables: data.data?.items ?? [] }
  } catch (err) {
    return { success: false, error: errText(err) }
  }
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
    const data = await feishuApiRequest<{
      code: number
      msg: string
      data?: { record?: { record_id?: string } }
    }>({
      appId,
      appSecret,
      domain,
      path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      body: { fields },
    })
    return { success: true, recordId: data.data?.record?.record_id }
  } catch (err) {
    return { success: false, error: errText(err) }
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
