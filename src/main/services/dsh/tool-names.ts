// =============================================================
// 提示词里的工具名 → dsh 侧模型可见名
//
// dsh 的 mcp-client 强制把工具注册为 `mcp__<serverName>__<rawName>`，没有关闭
// 前缀的开关。app 的 SOUL.md / rules.md 里写的是裸名（如 class_create），
// 于是走 dsh 时模型读到「可以用 class_create」而可调用列表里只有
// mcp__eaa__class_create —— 表现为模型反复调用不存在的工具。
//
// 只改写 system prompt：用户消息里可能含学生姓名/作业正文，替换它会破坏内容。
// =============================================================

import { createHash } from 'node:crypto'

const WORD_CHAR = /[A-Za-z0-9_]/
/** 与 @deepseek-ai/dsh-mcp-client 的 publicToolName 一致。 */
const MAX_PUBLIC_NAME_LENGTH = 64
const HASH_LENGTH = 12
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/**
 * dsh 注册给模型的工具名。短且字符合法时是 `mcp__<server>__<raw>`。
 * 超长或含非法字符时，截断并附上和 dsh 相同的哈希，避免提示词里的名字对不上。
 */
export function mcpPublicName(rawName: string, serverName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256')
    .update(`${serverName}\0${rawName}`)
    .digest('hex')
    .slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * 按 map 的键替换文本中独立出现的工具名。
 *
 * 先按长度降序：`class_list` 与 `class_list_all` 共存时，短名若先替换会吃掉
 * 长名的前缀，留下 `mcp__eaa__class_list_all` 里夹着旧名的坏结果。
 * 手工扫描而非 \b 正则：工具名含下划线，\b 在下划线两侧不成立。
 */
export function rewriteToolNames(text: string, nameMap: Readonly<Record<string, string>>): string {
  const names = Object.keys(nameMap).sort((a, b) => b.length - a.length)
  if (!names.length || !text) return text

  let out = ''
  let i = 0
  scan: while (i < text.length) {
    for (const name of names) {
      if (!text.startsWith(name, i)) continue
      const before = i > 0 ? text[i - 1] : ''
      const afterIndex = i + name.length
      const after = afterIndex < text.length ? text[afterIndex] : ''
      // 只在不是更长标识符的一部分时替换（foo_class_list / class_list_foo 都不动）
      if ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after))) continue
      out += nameMap[name]
      i = afterIndex
      continue scan
    }
    out += text[i]
    i += 1
  }
  return out
}

/** 构造 原名 → 模型可见名 的映射（serverName 由挂载它的 profile 决定） */
export function mcpToolNameMap(
  tools: readonly { name: string }[],
  serverName: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of tools) out[t.name] = mcpPublicName(t.name, serverName)
  return out
}
