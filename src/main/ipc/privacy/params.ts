// =============================================================
// 隐私引擎参数校验 — 密码/文本/枚举 sanitize(防命令注入)
// M17a: 不可见字符剥离已收敛到 utils/sanitize.stripInvisibleUnicode;
// 下列变体与统一版 sanitizeName/sanitizeFreeText 的语义差异逐条注明,有意保留。
// =============================================================

import { stripInvisibleUnicode } from '../../utils/sanitize'

/**
 * 密码校验：必须是非空字符串，长度 4-128。
 * 有意保留的本地变体,不与 utils/sanitize 合并:
 * 密码不是 EAA CLI 参数,不做字符集/元字符清洗(密码本就允许任意可打印字符,
 * 包括 ` ; & 等元字符与 -- 前缀),仅做类型与长度边界校验。
 */
export function validatePassword(password: unknown): string {
  if (typeof password !== 'string') {
    throw new Error('password must be a string')
  }
  if (password.length < 4 || password.length > 128) {
    throw new Error('password length must be 4-128 chars')
  }
  return password
}

/**
 * 通用字符串 sanitize：剥离不可见字符，拒绝危险输入。
 * 有意保留的本地变体,不与 utils/sanitize 的统一版合并,差异如下 —
 *   - 允许换行: masking text 是自由文本且会整段写入隐私引擎,
 *     统一版 sanitizeFreeText 拒绝全部控制字符([\x00-\x1F\x7F],含 \n),
 *     本版仅拒绝 NUL(\x00)并统一 \r\n → \n(多行文本合法)
 *   - 允许 shell 元字符: 文本进入本地隐私引擎(Rust 进程 stdin/内部数据),
 *     不作为 EAA CLI 参数 VALUE 传递,统一版的元字符黑名单在此过严
 *   - 允许路径分隔符: destPath 参数本身就是要写出的文件路径,
 *     统一版 sanitizeName 拒绝 / \ 会在本场景误伤
 *   - max 默认 4096(统一版 sanitizeFreeText 默认 500): masking 文本为整段内容
 * 共同部分(不可见字符剥离/trim/空值拒绝/NUL 拒绝/-- 前缀拒绝)语义一致,
 * 其中剥离正则已收敛为 utils/sanitize.stripInvisibleUnicode 单一实现。
 */
export function sanitize(input: unknown, field: string, max = 4096): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  if (input.length === 0) {
    throw new Error(`${field} cannot be empty`)
  }
  if (input.length > max) {
    throw new Error(`${field} too long (max ${max} chars)`)
  }
  // 剥离不可见 Unicode 字符（零宽空格、BOM、软连字符等），保留正常文本
  // (strip+trim 与 \r\n 归一化先后次序对最终结果无影响: trim 只作用于首尾空白)
  const cleaned = stripInvisibleUnicode(input).replace(/\r\n/g, '\n') // 统一换行
  if (cleaned.length === 0) {
    throw new Error(`${field} is empty after cleaning`)
  }
  // 仅拒绝 NUL 字节（唯一真正危险的控制字符）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional NUL-byte guard
  if (/\x00/.test(cleaned)) {
    throw new Error(`${field} contains null bytes`)
  }
  if (cleaned.startsWith('--')) {
    throw new Error(`${field} cannot start with --`)
  }
  return cleaned
}

/** 限定枚举 sanitize */
export function sanitizeEnum<T extends string>(
  input: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof input !== 'string' || !(allowed as readonly string[]).includes(input)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return input as T
}

export const ENTITY_TYPES = [
  'person',
  'place',
  'org',
  'phone',
  'email',
  'id_card',
  'student_id',
] as const
