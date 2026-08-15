// =============================================================
// Academic 参数校验 — 学生姓名安全过滤
// 委托统一 sanitize 实现(src/main/utils/sanitize.ts),消除本地漂移副本。
// 保留单参数签名 (name: string) => string,调用方 grade-handlers 零改动。
// 统一后自动获得 -- 前缀防护与 / 路径分隔符拒绝(有意的安全收敛)。
// =============================================================

import { sanitizeName as sanitizeNameUnified } from '../../utils/sanitize'

/** 学生姓名安全过滤(委托统一实现,行为与 eaa 域 sanitizeName 一致) */
export function sanitizeName(name: string): string {
  return sanitizeNameUnified(name, 'name')
}
