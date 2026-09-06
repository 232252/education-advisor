// =============================================================
// 长报告 Markdown 安全切分器(流畅度 2026-09-02 智能调优)
//
// 目的: Reports 预览此前一次性对全文跑 react-markdown + rehype-katex,
// 数千行报告选中即主线程卡顿。切分后配合懒挂载(视口附近才渲染),
// KaTeX/表格的重活推迟到滚动到位置。
//
// 切分安全性(为什么不直接按字符切/按空行切):
//   - ``` 与 ~~~ 围栏代码块内部可能包含 '#'、'|'、表格等任意文本,
//     在 fence 中间切会让两段各自变成不完整代码块/错误渲染 —
//     用前缀表标记每行是否处于未闭合 fence 中,处于其中的行绝不作为切点
//   - 表格行(| 开头)中间切会破坏表格 — 相邻两行都是表格行时不切
//   - 标题行(#{1,6} 开头)是优先切点: 一个段落通常以标题开始
//
// 纯函数,便于单测(fence/表格/标题/超大段落/CJK 各场景)。
// =============================================================

/** 默认目标块大小(字符) — 8K 字符约 2-4K token,单次 Markdown+KaTeX 解析 <20ms */
const DEFAULT_TARGET_CHARS = 8000

interface FenceMarker {
  char: string
  len: number
}

function fenceMarkerOf(line: string): FenceMarker | null {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  return m ? { char: m[1][0], len: m[1].length } : null
}

function isHeadingLine(line: string): boolean {
  return /^ {0,3}#{1,6}\s/.test(line)
}

function isTableRowLine(line: string): boolean {
  return /^\s*\|/.test(line)
}

/**
 * 把长 Markdown 切成 fence 安全的块,用于渐进/懒渲染。
 * 返回顺序拼接后与原文一致的块数组(以 \n 连接等价原文);
 * 内容短于目标块大小时返回单块(零行为变化)。
 */
export function splitMarkdownForLazyRender(
  content: string,
  targetChunkChars = DEFAULT_TARGET_CHARS,
): string[] {
  if (!content) return ['']
  const lines = content.split('\n')
  const n = lines.length
  if (content.length <= targetChunkChars) return [content]

  // 前缀表: 每行"开头时"是否处于未闭合 fence 中(关闭判定与 CommonMark 一致:
  // 同字符且长度 ≥ 开头围栏,行内其余部分为空白)
  const inFence: boolean[] = new Array(n).fill(false)
  let fence: FenceMarker | null = null
  for (let i = 0; i < n; i++) {
    inFence[i] = fence !== null
    const m = fenceMarkerOf(lines[i])
    if (fence) {
      if (m && m.char === fence.char && m.len >= fence.len) fence = null
    } else if (m) {
      fence = m
    }
  }

  // 切在行 i 之前是否安全: 行 i 不在 fence 中,且不处于表格行中间
  const cutSafeBefore = (i: number): boolean => {
    if (i <= 0 || i >= n) return false
    if (inFence[i]) return false
    if (isTableRowLine(lines[i - 1]) && isTableRowLine(lines[i])) return false
    return true
  }

  const chunks: string[] = []
  let chunkStart = 0
  // 前缀和: prefix[i] = 前 i 行字符量(含换行);块长 = prefix[i] - prefix[chunkStart]
  const prefix: number[] = new Array(n + 1).fill(0)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + lines[i].length + 1
  let lastPreferred = -1 // 当前块内最后一个标题切点
  let lastSafe = -1 // 当前块内最后一个安全切点

  // 候选切点 c 若切出全空白块(如 fence 前的空行)则拒绝 —
  // 空白块没有任何渲染收益,还会把相邻内容割裂成怪异边界
  const wouldBeBlank = (c: number): boolean => {
    for (let j = chunkStart; j < c; j++) {
      if (lines[j].trim() !== '') return false
    }
    return true
  }

  const pushChunk = (cut: number): void => {
    chunks.push(lines.slice(chunkStart, cut).join('\n'))
    chunkStart = cut
    lastPreferred = -1
    lastSafe = -1
  }

  for (let i = 1; i <= n; i++) {
    if (i < n && cutSafeBefore(i)) {
      lastSafe = i
      if (isHeadingLine(lines[i])) lastPreferred = i
    }
    if (prefix[i] - prefix[chunkStart] >= targetChunkChars) {
      // 优先标题切点 → 任意安全切点 → 若当前位置不安全(如 fence 深处)继续累积
      const cut =
        lastPreferred > chunkStart && !wouldBeBlank(lastPreferred)
          ? lastPreferred
          : lastSafe > chunkStart && !wouldBeBlank(lastSafe)
            ? lastSafe
            : i < n && cutSafeBefore(i)
              ? i
              : -1
      if (cut !== -1) pushChunk(cut)
    }
  }
  if (chunkStart < n) chunks.push(lines.slice(chunkStart).join('\n'))
  return chunks.length > 0 ? chunks : [content]
}
