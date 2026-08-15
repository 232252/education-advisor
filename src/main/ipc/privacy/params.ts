// =============================================================
// 隐私引擎参数校验 — 密码/文本/枚举 sanitize(防命令注入)
// =============================================================

/** 密码校验：必须是非空字符串，长度 4-128 */
export function validatePassword(password: unknown): string {
  if (typeof password !== 'string') {
    throw new Error('password must be a string')
  }
  if (password.length < 4 || password.length > 128) {
    throw new Error('password length must be 4-128 chars')
  }
  return password
}

/** 通用字符串 sanitize：剥离不可见字符，拒绝危险输入 */
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
  const cleaned = input
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .replace(/\r\n/g, '\n') // 统一换行
    .trim()
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
