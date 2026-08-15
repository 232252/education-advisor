// =============================================================
// feishu/config — 域名版本与 Open API base 配置
// 从 feishu-service.ts 拆出(纯重构,行为不变)
// =============================================================

/** 飞书域名版本: 'feishu' 国内版 / 'lark' 国际版 */
export type FeishuDomain = 'feishu' | 'lark'

/**
 * 根据域名版本返回 Open API base。
 * - feishu: 国内版 https://open.feishu.cn/open-apis
 * - lark:   国际版 https://open.larksuite.com/open-apis
 */
export function getApiBase(domain: FeishuDomain): string {
  return domain === 'lark'
    ? 'https://open.larksuite.com/open-apis'
    : 'https://open.feishu.cn/open-apis'
}

/** fetch 超时上限,防止 DNS 失败或服务器 hang 导致无限等待 */
export const FEISHU_FETCH_TIMEOUT_MS = 15_000
