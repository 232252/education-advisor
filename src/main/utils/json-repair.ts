/**
 * 本地 JSON 解析修复工具
 * 处理常见模型输出问题：截断 JSON、尾逗号、多余文本等
 */

function parseJsonWithRepair<T = unknown>(json: string): T {
  // 先尝试直接解析
  try {
    return JSON.parse(json) as T
  } catch {
    // 继续修复尝试
  }

  let text = json.trim()

  // 去除 markdown 代码块标记
  text = text
    .replace(/```(?:json)?\s*/g, '')
    .replace(/```$/g, '')
    .trim()

  // 如果 JSON 被文本包裹，尝试提取 { 到 } 之间的内容
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(candidate) as T
    } catch {
      // 继续修复尝试
    }
  }

  // 修复尾逗号（对象/数组末尾的逗号）
  text = text.replace(/,\s*([}\]])/g, '$1')

  // 尝试修复
  try {
    return JSON.parse(text) as T
  } catch {
    // 继续修复尝试
  }

  // 处理截断的字符串值（缺少闭合引号）：逐字符扫描，若最终停在字符串内部则补上闭合引号
  let insideString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      insideString = !insideString
    }
  }
  if (insideString) {
    text = `${text}"`
  }

  // 最后尝试
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new Error(`JSON 解析失败: ${(err as Error).message}`)
  }
}

export { parseJsonWithRepair }
