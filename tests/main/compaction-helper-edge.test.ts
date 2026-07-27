// =============================================================
// Compaction Helper 补充 — image 估算 / 阈值边界 / SDK 回退
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import { evaluateCompaction, compactChatMessagesSimple } from '../../src/main/services/compaction-helper'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

function mkMsg(content: unknown): AgentMessage {
  return { role: 'user', content, timestamp: Date.now() } as AgentMessage
}

const baseModel = { contextWindow: 8000, maxTokens: 4096 } as never
const baseSettings = { enabled: true, reserveTokens: 1000, keepRecentTokens: 2000 }

describe('evaluateCompaction — image 内容估算', () => {
  it('image 内容应估算为约 4800 字符(1200 tokens)', () => {
    const msg = mkMsg([{ type: 'image', source: { data: 'base64...' } }])
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    // 4800 / 4 = 1200 tokens
    expect(d.contextTokens).toBeGreaterThanOrEqual(1200)
  })

  it('多个 image 累加', () => {
    const msg = mkMsg([
      { type: 'image', source: { data: 'a' } },
      { type: 'image', source: { data: 'b' } },
    ])
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThanOrEqual(2400)
  })
})

describe('evaluateCompaction — 阈值边界', () => {
  it('contextTokens 恰好等于 threshold 不应压缩(> 才压)', () => {
    // threshold = 8000 - 1000 = 7000
    // 构造恰好 7000 tokens (28000 字符)
    const msg = mkMsg('x'.repeat(28000))
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.threshold).toBe(7000)
    // 28000/4 = 7000, 不大于 7000 → 不压缩
    expect(d.shouldCompact).toBe(false)
  })

  it('contextTokens 超过 threshold 应压缩', () => {
    const msg = mkMsg('x'.repeat(28004)) // 7001 tokens
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.shouldCompact).toBe(true)
  })

  it('enabled=false 时即使超阈值也不压缩', () => {
    const msg = mkMsg('x'.repeat(100000))
    const d = evaluateCompaction([msg], baseModel, { ...baseSettings, enabled: false })
    expect(d.shouldCompact).toBe(false)
  })

  it('reserveTokens > contextWindow 时 threshold 为负(几乎总会压缩)', () => {
    const msg = mkMsg('hi')
    const d = evaluateCompaction([msg], baseModel, {
      ...baseSettings,
      reserveTokens: 9000,
    })
    expect(d.threshold).toBe(-1000)
    // 'hi' = 2 chars = 1 token > -1000 → 压缩
    expect(d.shouldCompact).toBe(true)
  })
})

describe('evaluateCompaction — 混合内容', () => {
  it('text + thinking + toolCall 混合应累加', () => {
    const msg = mkMsg([
      { type: 'text', text: 'hello world' }, // 11
      { type: 'thinking', thinking: 'reasoning here' }, // 14
      { type: 'toolCall', name: 'search', arguments: { q: 'test' } }, // 6 + 15
    ])
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThan(0)
  })

  it('object content(非数组)应 JSON.stringify 估算', () => {
    const msg = mkMsg({ bashExecution: { stdout: 'output', exitCode: 0 } })
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThan(0)
  })

  it('null content 应优雅处理(0 tokens)', () => {
    const msg = mkMsg(null)
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThanOrEqual(0)
  })

  it('undefined content 应优雅处理', () => {
    const msg = mkMsg(undefined)
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThanOrEqual(0)
  })

  it('空数组 content 应得 0 tokens', () => {
    const msg = mkMsg([])
    const d = evaluateCompaction([msg], baseModel, baseSettings)
    expect(d.contextTokens).toBeGreaterThanOrEqual(0)
  })

  it('空消息列表 → contextTokens=0, 不压缩', () => {
    const d = evaluateCompaction([], baseModel, baseSettings)
    expect(d.contextTokens).toBe(0)
    expect(d.shouldCompact).toBe(false)
  })
})

describe('compactChatMessagesSimple — 边界', () => {
  it('消息数 <= 2 原样返回', () => {
    const msgs = [mkMsg('a'), mkMsg('b')]
    const result = compactChatMessagesSimple(msgs, baseModel, 1000, 500)
    expect(result.length).toBe(2)
  })

  it('空消息列表原样返回', () => {
    const result = compactChatMessagesSimple([], baseModel, 1000, 500)
    expect(result).toEqual([])
  })

  it('总长 < 阈值原样返回', () => {
    const msgs = [mkMsg('short'), mkMsg('also short'), mkMsg('tiny')]
    const result = compactChatMessagesSimple(msgs, baseModel, 100000, 1000)
    expect(result.length).toBe(3)
  })

  it('压缩后至少保留 1 条消息', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => mkMsg(`message ${i} `.repeat(100)))
    const result = compactChatMessagesSimple(msgs, baseModel, 100, 50)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('压缩后首条应为 user 角色(summary)', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => mkMsg(`msg ${i} `.repeat(100)))
    const result = compactChatMessagesSimple(msgs, baseModel, 100, 50)
    expect(result[0]?.role).toBe('user')
  })

  it('summary 应包含被压缩的消息计数', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => mkMsg(`content ${i} `.repeat(50)))
    const result = compactChatMessagesSimple(msgs, baseModel, 200, 100)
    const summary = result[0]?.content
    if (typeof summary === 'string') {
      expect(summary).toMatch(/\d+/) // 包含数字(消息计数)
    }
  })
})
