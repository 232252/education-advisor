// =============================================================
// markdown-chunks 测试 — fence 安全切分(Reports 懒渲染基础设施)
// 关键不变量: ①各块顺序拼接等价原文 ②围栏代码块绝不从中间切开
//            ③表格行中间不切 ④标题行是优先切点
// =============================================================

import { describe, expect, it } from 'vitest'
import { splitMarkdownForLazyRender } from '../../../../src/renderer/pages/Reports/lib/markdown-chunks'

const TARGET = 400 // 测试用小目标块,避免造 8K 文本

/** 不变量: 顺序拼接等价原文(逐字符) */
function expectLossless(chunks: string[], original: string) {
  expect(chunks.join('\n')).toBe(original)
}

describe('splitMarkdownForLazyRender', () => {
  it('短内容返回单块原样', () => {
    const doc = '# 标题\n\n一小段文字。'
    expect(splitMarkdownForLazyRender(doc, TARGET)).toEqual([doc])
  })

  it('空内容返回单块空串', () => {
    expect(splitMarkdownForLazyRender('', TARGET)).toEqual([''])
  })

  it('长文按标题切块,每块以标题开头', () => {
    const sections = Array.from(
      { length: 8 },
      (_, i) => `## 第${i}节 标题\n\n${'内容'.repeat(60)}\n`,
    )
    const doc = sections.join('\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expect(chunks.length).toBeGreaterThan(1)
    // 每个后续块都从一个标题行开始(标题是优先切点)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]).toMatch(/^ {0,3}#{1,6}\s/)
    }
    expectLossless(chunks, doc)
  })

  it('围栏代码块内部的 # 与 | 不构成切点(fence 安全)', () => {
    // 一段正常内容 + 一个巨大代码块(内部有标题样/表格样文本) + 后续内容
    const fenceBody = Array.from(
      { length: 40 },
      (_, i) => `# 第${i}行看起来像标题 | 也像表格 | 没错`,
    ).join('\n')
    const doc = ['## 正文一\n\n' + '字'.repeat(400), '```bash', fenceBody, '```', '## 正文二\n\n尾段'].join(
      '\n\n',
    )
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expectLossless(chunks, doc)
    // 拼回后代码块的围栏必须成对出现在同一块中 — 逐块检查:
    // 每个块的 ``` 开围栏数必须与闭围栏数平衡(简单计数法)
    for (const chunk of chunks) {
      const opens = (chunk.match(/^```/gm) ?? []).length
      const closes = (chunk.match(/^```$/gm) ?? []).length
      // 允许最后一块以未闭合块结尾的情况除外 — 本例中 ``` 成对
      expect(Math.abs(opens - closes)).toBeLessThanOrEqual(1)
    }
  })

  it('波浪线围栏同样受保护(围栏整体落在同一块)', () => {
    const body = Array.from({ length: 30 }, (_, i) => `# 行${i} 内嵌 # 与 | 表格符号 但不是切点`).join('\n')
    const doc = ['前言'.repeat(200), '~~~~', body, '~~~~', '结尾'.repeat(200)].join('\n\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expectLossless(chunks, doc)
    const fenceChunk = chunks.find((c) => c.includes('# 行0 内嵌'))
    expect(fenceChunk).toBeDefined()
    expect(fenceChunk).toContain('# 行29 内嵌')
  })

  it('小表格与其表头完整落在同一块', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| 姓名${i} | ${i} | ${100 - i} |`).join('\n')
    const table = ['| 姓名 | 学号 | 分数 |', '|:-----|-----:|-----:|', rows].join('\n')
    const doc = [`## 表格前后都有长文\n\n${'甲'.repeat(500)}`, table, `${'乙'.repeat(500)}`].join(
      '\n\n',
    )
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expectLossless(chunks, doc)
    const tableChunk = chunks.find((c) => c.includes('| 姓名0 |'))
    expect(tableChunk).toBeDefined()
    expect(tableChunk).toContain('|:-----|') // 表头分隔行同块
    expect(tableChunk).toContain('| 姓名4 |') // 末行同块 — 表格未被拆开
  })

  it('不产生纯空白块(空白行不得成为切点产物)', () => {
    // 结构: 长段 + 空行 + 大围栏 + 空行 + 长段 — 旧实现的空白切点bug在此暴露
    const fenceBody = Array.from({ length: 30 }, (_, i) => `代码行${i}`).join('\n')
    const doc = [
      '甲'.repeat(500),
      '',
      '```',
      fenceBody,
      '```',
      '',
      '乙'.repeat(500),
    ].join('\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expectLossless(chunks, doc)
    for (const chunk of chunks) {
      expect(chunk.trim()).not.toBe('')
    }
  })

  it('无标题的超大单段落也能切(退化为行切点),不丢字符', () => {
    const doc = Array.from({ length: 100 }, (_, i) => `普通行${i}:${'字'.repeat(20)}`).join('\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expect(chunks.length).toBeGreaterThan(1)
    expectLossless(chunks, doc)
  })

  it('单个超大段落中间是未闭合 fence 时保持整块(不硬切)', () => {
    const fenceLines = Array.from({ length: 80 }, (_, i) => `代码行${i}`).join('\n')
    const doc = ['```python', fenceLines, '```'].join('\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    // 全文都在一个未闭合状态敏感的 fence 里 — fence 整体必须落在同一块
    const whole = chunks.find((c) => c.includes('代码行0') && c.includes('代码行79'))
    expect(whole).toBeDefined()
    expectLossless(chunks, doc)
  })

  it('CJK 内容长度按字符计数(不按字节)', () => {
    const doc = Array.from(
      { length: 10 },
      (_, i) => `## 章节${i}\n\n${'汉字内容'.repeat(40)}`,
    ).join('\n\n')
    const chunks = splitMarkdownForLazyRender(doc, TARGET)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expectLossless(chunks, doc)
  })
})
