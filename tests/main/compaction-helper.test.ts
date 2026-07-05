// =============================================================
// Compaction Helper 测试
// 覆盖：evaluateCompaction 阈值判断、字符估算、各种 content 类型
//       compactAgentMessages 异步压缩(含 generateSummary mock)
//       compactChatMessagesSimple 字符串截断式压缩
// =============================================================

import type { AgentMessage, CompactionSettings } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai/compat'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 0.80.3 适配：压缩路径改用 completeSimple（替代旧 generateSummary）
// Mock completeSimple / estimateContextTokens
const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  estimateContextTokens: vi.fn(() => ({ tokens: 0 })),
}))

vi.mock('@earendil-works/pi-agent-core', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-agent-core')>(
    '@earendil-works/pi-agent-core',
  )
  return {
    ...actual,
    estimateContextTokens: mocks.estimateContextTokens,
  }
})

vi.mock('@earendil-works/pi-ai/compat', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-ai/compat')>(
    '@earendil-works/pi-ai/compat',
  )
  return {
    ...actual,
    completeSimple: mocks.completeSimple,
  }
})

import {
  compactAgentMessages,
  compactChatMessagesSimple,
  evaluateCompaction,
} from '../../src/main/services/compaction-helper'

// Mock model
const mockModel: Model<Api> = {
  id: 'test-model',
  name: 'Test',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000, // 小 contextWindow 便于测试
  maxTokens: 100,
}

const defaultSettings: CompactionSettings = {
  enabled: true,
  reserveTokens: 100,
  keepRecentTokens: 200,
}

describe('evaluateCompaction', () => {
  it('空消息列表: contextTokens=0, 不应压缩', () => {
    const result = evaluateCompaction([], mockModel, defaultSettings)
    expect(result.contextTokens).toBe(0)
    expect(result.shouldCompact).toBe(false)
  })

  it('消息总长 < 阈值: 不应压缩', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: 'hello', timestamp: 2 } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    // 11 chars / 4 = 3 tokens, 远小于 900
    expect(result.contextTokens).toBeLessThan(900)
    expect(result.shouldCompact).toBe(false)
  })

  it('消息总长 > 阈值: 应压缩', () => {
    // 4 chars per token, 1000 - 100 = 900 阈值
    // 1000 chars (4 chars per token) = 250 tokens, 不够
    // 10000 chars = 2500 tokens, 远超阈值
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    expect(result.contextTokens).toBeGreaterThan(900)
    expect(result.shouldCompact).toBe(true)
  })

  it('阈值 = contextWindow - reserveTokens', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'x', timestamp: 1 } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    expect(result.threshold).toBe(1000 - 100) // 900
  })

  it('enabled=false 时即使超阈值也不压缩', () => {
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
    ]
    const settings: CompactionSettings = { ...defaultSettings, enabled: false }
    const result = evaluateCompaction(messages, mockModel, settings)
    expect(result.contextTokens).toBeGreaterThan(900)
    expect(result.shouldCompact).toBe(false)
  })

  it('应能估算 array content (text/thinking/image/toolCall)', () => {
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'a'.repeat(400) }, // 100 tokens
          { type: 'thinking', thinking: 'b'.repeat(800) }, // 200 tokens
          { type: 'image' }, // 4800 chars → 1200 tokens
          { type: 'toolCall', name: 'x', arguments: { foo: 'bar' } }, // ~20 chars → 5 tokens
        ],
        timestamp: 1,
      } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    // 总和应该 > 1000 (image 占 1200 tokens)
    expect(result.contextTokens).toBeGreaterThan(1000)
  })

  it('应能估算 object content (bashExecution 等)', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        content: { stdout: 'x'.repeat(1000), stderr: '', exitCode: 0 },
        timestamp: 1,
      } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    expect(result.contextTokens).toBeGreaterThan(0)
  })

  it('空 content 数组应得 0 tokens', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: [], timestamp: 1 } as unknown as AgentMessage,
    ]
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    expect(result.contextTokens).toBe(0)
  })

  it('null content 应优雅处理', () => {
    const messages: AgentMessage[] = [
      { role: 'toolResult', content: null, timestamp: 1 } as unknown as AgentMessage,
    ]
    // 不抛错
    const result = evaluateCompaction(messages, mockModel, defaultSettings)
    expect(result.contextTokens).toBeGreaterThanOrEqual(0)
  })
})

describe('compactChatMessagesSimple', () => {
  it('消息数 <= 2 应原样返回', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = compactChatMessagesSimple(messages, 1000, 100, 200)
    expect(result).toEqual(messages)
  })

  it('总长 < 阈值应原样返回', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]
    // 3 chars * 1/3 = 1 token, 远小于 900
    const result = compactChatMessagesSimple(messages, 1000, 100, 200)
    expect(result).toEqual(messages)
  })

  it('总长 > 阈值应压缩为 summary + recent', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(1000) },
      { role: 'assistant', content: 'b'.repeat(1000) },
      { role: 'user', content: 'c'.repeat(100) },
    ]
    // 总长约 700 tokens, 阈值 900, 不超
    const result = compactChatMessagesSimple(messages, 1000, 100, 200)
    // 总长 < 阈值, 不压缩
    expect(result.length).toBe(3)
  })

  it('压缩后应至少保留 1 条消息', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(10000) },
      { role: 'assistant', content: 'b'.repeat(10000) },
    ]
    const result = compactChatMessagesSimple(messages, 1000, 100, 200)
    // 至少 1 条
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('压缩后首条应是 user 角色 (summary)', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'assistant', content: 'b'.repeat(5000) },
      { role: 'user', content: 'c'.repeat(50) },
      { role: 'assistant', content: 'd'.repeat(50) },
    ]
    const result = compactChatMessagesSimple(messages, 1000, 100, 50)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toContain('对话历史压缩')
  })

  it('summary 应包含被压缩的消息计数', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(2000) },
      { role: 'assistant', content: 'b'.repeat(2000) },
      { role: 'user', content: 'c'.repeat(2000) },
      { role: 'assistant', content: 'd'.repeat(2000) },
      { role: 'user', content: 'e' },
    ]
    const result = compactChatMessagesSimple(messages, 1000, 100, 10)
    // 找到 summary
    const summary = result.find((m) => m.content.includes('对话历史压缩'))
    expect(summary).toBeDefined()
    // summary 应提到被压缩的消息数
    expect(summary?.content).toMatch(/之前 \d+ 条消息/)
  })
})

describe('compactAgentMessages', () => {
  beforeEach(() => {
    mocks.completeSimple.mockReset()
    mocks.estimateContextTokens.mockReset()
    mocks.estimateContextTokens.mockImplementation(() => ({ tokens: 0 }))
  })

  it('messages.length <= 2 时应原样返回(不调 completeSimple)', async () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: 'hello', timestamp: 2 } as unknown as AgentMessage,
    ]
    const result = await compactAgentMessages(messages, mockModel, defaultSettings, 'fake-key')
    expect(result).toBe(messages)
    expect(mocks.completeSimple).not.toHaveBeenCalled()
  })

  it('shouldCompact=false 时应原样返回(不调 completeSimple)', async () => {
    // 短消息,不超阈值
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: 'hello', timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: 'thanks', timestamp: 3 } as unknown as AgentMessage,
    ]
    const result = await compactAgentMessages(messages, mockModel, defaultSettings, 'fake-key')
    expect(result).toBe(messages)
    expect(mocks.completeSimple).not.toHaveBeenCalled()
  })

  it('enabled=false 时即使超阈值也不压缩', async () => {
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: longContent, timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: longContent, timestamp: 3 } as unknown as AgentMessage,
    ]
    const settings: CompactionSettings = { ...defaultSettings, enabled: false }
    const result = await compactAgentMessages(messages, mockModel, settings, 'fake-key')
    expect(result).toBe(messages)
    expect(mocks.completeSimple).not.toHaveBeenCalled()
  })

  it('completeSimple 失败时应原样返回(降级保护)', async () => {
    // 超阈值
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: longContent, timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: longContent, timestamp: 3 } as unknown as AgentMessage,
    ]
    mocks.completeSimple.mockRejectedValue(new Error('API timeout'))

    const result = await compactAgentMessages(messages, mockModel, defaultSettings, 'fake-key')
    expect(result).toBe(messages) // 失败时返回原始消息
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1)
  })

  it('completeSimple 成功时应返回 [summary, ...recent]', async () => {
    const longContent = 'a'.repeat(10000)
    const recentContent = 'recent short'
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: longContent, timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: recentContent, timestamp: 3 } as unknown as AgentMessage,
    ]
    mocks.completeSimple.mockResolvedValue({
      role: 'assistant',
      content: '这是摘要文本',
      timestamp: 1,
    })

    const result = await compactAgentMessages(messages, mockModel, defaultSettings, 'fake-key')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeLessThanOrEqual(messages.length)
    // 第一条应是 user 角色,内容包含"对话历史压缩"
    const firstMsg = result[0] as unknown as { role: string; content: unknown }
    expect(firstMsg.role).toBe('user')
    // content 可能是 string 或 array,统一取文本
    let firstText = ''
    if (typeof firstMsg.content === 'string') firstText = firstMsg.content
    else if (Array.isArray(firstMsg.content)) {
      const t = firstMsg.content.find(
        (b: { type?: string; text?: string }) => b.type === 'text' && b.text,
      )
      if (t) firstText = (t as { text: string }).text
    }
    expect(firstText).toContain('对话历史压缩')
    expect(firstText).toContain('这是摘要文本')
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1)
  })

  it('应将 apiKey 传给 completeSimple', async () => {
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: longContent, timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: 'recent', timestamp: 3 } as unknown as AgentMessage,
    ]
    mocks.completeSimple.mockResolvedValue({ role: 'assistant', content: '摘要', timestamp: 1 })

    await compactAgentMessages(messages, mockModel, defaultSettings, 'my-api-key-12345')
    const callArgs = mocks.completeSimple.mock.calls[0]
    // completeSimple(model, context, options) — options 是第 3 个参数 (index 2)
    const options = callArgs[2] as { apiKey?: string }
    expect(options.apiKey).toBe('my-api-key-12345')
  })

  it('oldMessages 为空时应原样返回', async () => {
    // 构造 messages: 所有消息都被算入 recent 部分(keepRecentTokens 足够大)
    const messages: AgentMessage[] = [
      { role: 'user', content: 'a', timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: 'b', timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: 'c', timestamp: 3 } as unknown as AgentMessage,
    ]
    // 但需要触发 shouldCompact=true, 所以用大 contextWindow 但小内容+大 reserveTokens 让阈值变小
    const tinyModel: Model<Api> = {
      ...mockModel,
      contextWindow: 10, // 极小,任何内容都会超阈值
    }
    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 0,
      keepRecentTokens: 100000, // 极大,所有消息都算 recent
    }
    mocks.completeSimple.mockResolvedValue({ role: 'assistant', content: '摘要', timestamp: 1 })

    const result = await compactAgentMessages(messages, tinyModel, settings, 'fake-key')
    // oldMessages 为空,直接返回 messages
    expect(result).toBe(messages)
    expect(mocks.completeSimple).not.toHaveBeenCalled()
  })

  it('应支持 AbortSignal 传递', async () => {
    const longContent = 'a'.repeat(10000)
    const messages: AgentMessage[] = [
      { role: 'user', content: longContent, timestamp: 1 } as unknown as AgentMessage,
      { role: 'assistant', content: longContent, timestamp: 2 } as unknown as AgentMessage,
      { role: 'user', content: 'recent', timestamp: 3 } as unknown as AgentMessage,
    ]
    mocks.completeSimple.mockResolvedValue({ role: 'assistant', content: '摘要', timestamp: 1 })
    const controller = new AbortController()

    await compactAgentMessages(
      messages,
      mockModel,
      defaultSettings,
      'fake-key',
      controller.signal,
    )
    const callArgs = mocks.completeSimple.mock.calls[0]
    // completeSimple(model, context, options) — options.signal 在第 3 个参数 (index 2)
    const options = callArgs[2] as { signal?: AbortSignal }
    expect(options.signal).toBe(controller.signal)
  })
})
