// =============================================================
// adapters/dingtalk/card-format — AI 卡片 markdown 归一化(纯函数)
// 钉钉 AI 卡片对 markdown 的渲染差异(与官方连接器 normalizeForCard
// 同源的简化版):
//   1. 表格分隔行前必须有空行,否则表格不渲染;
//   2. 非代码块内的单个换行渲染为空格 → 逐行判定:块级语法保留 \n,
//      普通行间用 <br>;连续引用行合并为一段 <br> 连接。
// =============================================================

/** 统一换行符为 \n */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 表格分隔行(如 |---|---| 或 --- | ---) */
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/
/** 表格数据行(含 | 分隔) */
const TABLE_ROW_RE = /^\s*\|?.*\|.*\|?\s*$/
/** markdown 块级语法起始(列表/表格/标题/分隔线) */
const MD_BLOCK_START_RE =
  /^(\s{0,3}(?:[-*+]|\d+[.)])[ ])|(\s{0,3}\|)|(\s{0,3}#{1,6}\s)|(\s{0,3}(?:[-*_])\s*(?:[-*_])\s*(?:[-*_]))/
const FENCE_RE = /^\s{0,3}```/
const QUOTE_RE = /^\s{0,3}>\s?/

/** 确保表格前有空行(空行缺失 → 表格被当普通文本) */
export function ensureTableBlankLines(text: string): string {
  const lines = normalizeLineEndings(text).split('\n')
  const result: string[] = []
  const isDivider = (line: string): boolean =>
    typeof line === 'string' && line.includes('|') && TABLE_DIVIDER_RE.test(line)
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    const next = lines[i + 1] ?? ''
    if (
      TABLE_ROW_RE.test(current) &&
      isDivider(next) &&
      i > 0 &&
      lines[i - 1].trim() !== '' &&
      !TABLE_ROW_RE.test(lines[i - 1])
    ) {
      result.push('')
    }
    result.push(current)
  }
  return result.join('\n')
}

/** 非代码块换行 → <br>;块级语法行与空行边界保留 \n */
function fixNewlines(text: string): string {
  const normalized = normalizeLineEndings(text)

  // 1. 合并连续引用行(代码块外): 去 > 前缀后以 <br> 连接,避免每行碎成小块
  const merged: string[] = []
  let pendingQuotes: string[] = []
  let inCodeBlock = false
  const flushQuotes = (): void => {
    if (pendingQuotes.length > 0) {
      merged.push(pendingQuotes.join('<br>'))
      pendingQuotes = []
    }
  }
  for (const line of normalized.split('\n')) {
    const isFence = FENCE_RE.test(line)
    if (inCodeBlock) {
      flushQuotes()
      merged.push(line)
      if (isFence) inCodeBlock = false
      continue
    }
    if (isFence) {
      flushQuotes()
      merged.push(line)
      inCodeBlock = true
      continue
    }
    if (QUOTE_RE.test(line)) {
      pendingQuotes.push(pendingQuotes.length === 0 ? line : line.replace(QUOTE_RE, ''))
    } else {
      flushQuotes()
      merged.push(line)
    }
  }
  flushQuotes()

  // 2. 逐行判定边界: 下一行是块级语法/空行,或当前在代码块内 → 保留 \n
  const lines = merged
  inCodeBlock = false
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    const nextInCodeBlock: boolean = FENCE_RE.test(current) ? !inCodeBlock : inCodeBlock
    if (i < lines.length - 1) {
      const next = lines[i + 1]
      const keepNewline =
        nextInCodeBlock ||
        current === '' ||
        next === '' ||
        FENCE_RE.test(next) ||
        MD_BLOCK_START_RE.test(next)
      parts.push(current + (keepNewline ? '\n' : '<br>'))
    } else {
      parts.push(current)
    }
    inCodeBlock = nextInCodeBlock
  }
  return parts.join('')
}

/** AI 卡片消息内容归一化入口(表格空行 + 换行修复) */
export function normalizeForCard(content: string): string {
  return fixNewlines(ensureTableBlankLines(content))
}

/**
 * 流式帧内容: 未结束帧去掉末尾换行,避免先渲染 <br> 再被下一帧修正的闪烁
 * (官方连接器同款处理)。
 */
export function streamFrameContent(content: string, finished: boolean): string {
  return finished ? content : content.replace(/\n+$/, '')
}
