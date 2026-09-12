// =============================================================
// 钉钉 AI 卡片 markdown 归一化 — 表格空行 / 换行→<br> / 代码块保留
// 锚定官方连接器 normalizeForCard 的关键行为。
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  ensureTableBlankLines,
  normalizeForCard,
  streamFrameContent,
} from '../../../src/main/services/channels/adapters/dingtalk/card-format'

describe('ensureTableBlankLines', () => {
  it('表格分隔行前无空行 → 补空行', () => {
    const input = '总结如下:\n| 名字 | 分数 |\n| --- | --- |\n| 张三 | 90 |'
    const out = ensureTableBlankLines(input)
    expect(out).toContain('总结如下:\n\n| 名字 | 分数 |')
  })

  it('已有空行 → 不重复补', () => {
    const input = '总结如下:\n\n| 名字 | 分数 |\n| --- | --- |'
    expect(ensureTableBlankLines(input)).toBe(input)
  })

  it('CRLF 统一为 LF', () => {
    const out = ensureTableBlankLines('a\r\nb\r\nc')
    expect(out).toBe('a\nb\nc')
  })
})

describe('normalizeForCard', () => {
  it('普通相邻行以 <br> 连接', () => {
    expect(normalizeForCard('第一行\n第二行')).toBe('第一行<br>第二行')
  })

  it('段落间空行保留(两个换行语义)', () => {
    expect(normalizeForCard('段落一\n\n段落二')).toBe('段落一\n\n段落二')
  })

  it('代码块内换行原样保留,代码块边界保留换行', () => {
    const input = '示例:\n```js\nconst a = 1\nconst b = 2\n```\n结束'
    const out = normalizeForCard(input)
    expect(out).toContain('```js\nconst a = 1\nconst b = 2\n```')
  })

  it('列表/标题等块级语法行前保留换行', () => {
    const out = normalizeForCard('前言\n# 标题\n- 项目一')
    expect(out).toContain('前言\n# 标题\n- 项目一')
  })

  it('连续引用行合并为一段 <br> 连接', () => {
    const out = normalizeForCard('> 第一句\n> 第二句')
    expect(out).toBe('> 第一句<br>第二句')
  })

  it('表格前补空行且块级语法不被 <br> 破坏', () => {
    const out = normalizeForCard('表格:\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out).toContain('表格:\n\n| a | b |')
  })
})

describe('streamFrameContent', () => {
  it('未结束帧去掉末尾换行(防 <br> 闪烁)', () => {
    expect(streamFrameContent('文本\n\n', false)).toBe('文本')
  })

  it('终帧保留完整内容', () => {
    expect(streamFrameContent('文本\n', true)).toBe('文本\n')
  })
})
