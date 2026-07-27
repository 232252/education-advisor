// =============================================================
// EAA 参数 sanitize 纯函数
// 从 eaa-handlers.ts 抽出,逻辑零修改(逐行对照搬迁)
// 这些是安全关键代码:防止命令注入 / 路径遍历 / 控制字符注入
// =============================================================

/**
 * 参数 sanitize:允许字母、数字、中文、常见姓名符号('()·.)、下划线、连字符。
 * 剥离不可见 Unicode 字符,拒绝 NUL 和以 -- 开头的输入(防止参数注入)。
 *
 * 安全关键:不要修改字符集逻辑,任何改动都需要安全审查。
 */
export function sanitizeName(name: unknown, field: string): string {
  if (typeof name !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  // 剥离不可见 Unicode 字符(零宽空格、BOM 等)
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error(`${field} cannot be empty`)
  }
  if (cleaned.length > 64) {
    throw new Error(`${field} too long (max 64 chars)`)
  }
  // 拒绝控制字符(包括 NUL、换行符 \n \r、制表符等,防止参数注入和数据损坏)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char guard against injection
  if (/[\x00-\x1F\x7F]/.test(cleaned)) {
    throw new Error(`${field} contains control characters`)
  }
  // P5 修复:拒绝路径分隔符和路径遍历序列(与 profile-handlers 保持一致)
  // studentName 虽然作为 CLI 参数传递而非文件路径,但 entity_id 不应含 / \
  // 且 ../ 可能被下游服务拼接成文件路径(如 logs/<name>.json)
  if (/[/\\]/.test(cleaned)) {
    throw new Error(`${field} contains path separators`)
  }
  if (cleaned.includes('..')) {
    throw new Error(`${field} contains path traversal sequence (..)`)
  }
  if (/[`$;|&<>{}\\]/.test(cleaned)) {
    throw new Error(`${field} contains illegal characters`)
  }
  // 拒绝以 -- 开头的输入(防止参数注入)
  if (cleaned.startsWith('--')) {
    throw new Error(`${field} cannot start with --`)
  }
  return cleaned
}

/**
 * 自由文本 sanitize:用于 note / reason 等描述性字段。
 *
 * 与 sanitizeName 的差异:
 *   - 允许路径分隔符 / \ (note 常含 "迟到/早退" 等正常文本)
 *   - 允许 .. 序列 (note 常含 "继续努力..." 等省略号)
 *   - 允许 . () · 等常见标点
 *   - 仍拒绝控制字符(数据损坏防护)
 *   - 仍拒绝 -- 前缀(参数注入防护)
 *   - 仍拒绝 shell 元字符(防御纵深,eaaBridge 用 cross-spawn 非 shell,
 *     但保持与 eaa-tools.ts sanitizeArg 一致的拦截策略)
 *
 * 安全分析:note 作为 --note <value> 的 VALUE 传递给 cross-spawn,
 * 不经过 shell 解析,所以 / ; & 等元字符在 VALUE 位置不构成命令注入。
 * 但 -- 前缀仍需拒绝(防止被 CLI 解析器误认为 flag)。
 */
export function sanitizeFreeText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  // 剥离不可见 Unicode 字符(零宽空格、BOM 等)
  const cleaned = value
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error(`${field} cannot be empty`)
  }
  if (cleaned.length > maxLength) {
    throw new Error(`${field} too long (max ${maxLength} chars)`)
  }
  // 拒绝控制字符(包括 NUL、换行符 \n \r、制表符等,防止数据损坏)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char guard against injection
  if (/[\x00-\x1F\x7F]/.test(cleaned)) {
    throw new Error(`${field} contains control characters`)
  }
  // 拒绝 shell 元字符(防御纵深,与 eaa-tools.ts sanitizeArg 一致)
  // 注意:与 sanitizeName 的差异 — 这里允许 ( ) 和 \,因为 note/reason 常含
  //   - "小明(三年级)" 等括号注释
  //   - "迟到\早退" 等路径分隔符(在 VALUE 位置不构成命令注入,cross-spawn 非 shell)
  // 安全分析:note 作为 --note <value> 的 VALUE 传递,cross-spawn 不经 shell 解析,
  // 所以 () \ 在 VALUE 位置不构成命令注入。仍拒绝 ; & | ` $ < > 等真正的 shell 元字符。
  if (/[&|;`$<>{}*?[\]#~!]/.test(cleaned)) {
    throw new Error(`${field} contains illegal characters`)
  }
  // 拒绝以 -- 开头的输入(防止参数注入:被 CLI 解析器误认为 flag)
  if (cleaned.startsWith('--')) {
    throw new Error(`${field} cannot start with --`)
  }
  return cleaned
}

/**
 * classId sanitize:只允许字母数字、连字符、点(用于班级编号如 "G7-3")
 */
export function sanitizeClassId(classId: unknown): string {
  if (typeof classId !== 'string') {
    throw new Error('classId must be a string')
  }
  const trimmed = classId.trim()
  if (trimmed.length === 0) {
    throw new Error('classId cannot be empty')
  }
  if (trimmed.length > 32) {
    throw new Error('classId too long (max 32 chars)')
  }
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) {
    throw new Error('classId must be alphanumeric, dot or hyphen only')
  }
  return trimmed
}

/**
 * 简单 shell-style tokenizer:支持双引号包裹含空格的复合参数。
 * 使用 /\s/(任何空白符)作为分隔符,比 eaa-tools.ts 原本的 ' '(仅空格)更健壮,
 * 能拦截 tab/换行注入。不支持转义引号(够用即可,避免与 Rust 端行为不一致)。
 *
 * 注意:P2 接入时会让 eaa-tools.ts 也改用本模块的版本,消除重复。
 * 行为差异:含 tab/换行的查询会被分割(原本 ' ' 版不会)。Agent LLM 输入几乎无 tab,风险极低。
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}
