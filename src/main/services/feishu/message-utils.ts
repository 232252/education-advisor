// =============================================================
// feishu-message-utils — 飞书消息处理纯函数
//
// 从 feishu-bot-service.ts 提取,包含三条 R6-7 安全修复的核心逻辑:
//   1. sanitizeObject    — 递归删除原型链污染键
//   2. safeJsonParse     — 解析后自动 sanitize
//   3. extractText       — 从飞书消息 JSON 提取纯文本
//
// 这些函数运行在每条入站飞书消息的热路径上,且直接关系到原型链污染
// 防御(security-critical)。原代码埋在 bot service 类内部,
// 无法被单元测试——抽出到这里后可以零 mock 测试。
// =============================================================

/**
 * R6-7 修复:递归删除 __proto__ / constructor / prototype 键,防止原型链污染。
 * 用于安全解析来自飞书 API / 消息内容的外部 JSON。
 *
 * 修改是 in-place 的(返回值与入参是同一引用),与原实现保持一致。
 */
export function sanitizeObject<T>(value: T): T {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = sanitizeObject(value[i])
    }
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete obj[key]
      } else {
        obj[key] = sanitizeObject(obj[key])
      }
    }
  }
  return value
}

/**
 * R6-7 修复:安全 JSON.parse,解析后递归清理原型链污染键。
 * @throws 当输入不是合法 JSON 时(JSON.parse 的原始行为)
 */
export function safeJsonParse<T>(text: string): T {
  return sanitizeObject(JSON.parse(text) as T)
}

/**
 * 从飞书消息 content 中提取纯文本,并去掉 @机器人 的占位符。
 *
 * @param content   JSON 字符串,如 {"text":"@_user_1 你好"}
 * @param mentions  @信息数组,key 是占位符(如 @_user_1)
 * @returns 清理并 trim 后的纯文本;空文本/无 text 字段时返回 ''
 *
 * 行为契约:
 *   - content 不是合法 JSON → 返回 trim 后的原字符串
 *   - JSON 无 text 字段或 text 为空 → 返回 ''
 *   - mentions.key 为空串 → 跳过该条(避免误删所有空串匹配)
 */
export function extractText(
  content: string,
  mentions: Array<{ key: string; name: string }>,
): string {
  let raw: string
  try {
    // R6-7 修复:使用 safeJsonParse 防止消息内容中的原型链污染
    const parsed = safeJsonParse<{ text?: string }>(content)
    raw = parsed.text ?? ''
  } catch {
    // content 不是合法 JSON,直接用原始字符串
    raw = content
  }
  if (!raw) return ''
  // 去掉 @机器人 占位符(@_user_1 等),保留其余文本
  let cleaned = raw
  for (const m of mentions) {
    if (m.key) {
      cleaned = cleaned.split(m.key).join('')
    }
  }
  return cleaned.trim()
}
