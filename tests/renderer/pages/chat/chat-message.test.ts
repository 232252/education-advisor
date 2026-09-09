// =============================================================
// chat-message 纯逻辑测试 — toAgentHistory(多轮上下文保真)
// 覆盖: 时间戳透传 / 工具结果快照注入 / 占位与超限过滤
// =============================================================

import { describe, expect, it } from 'vitest'
import { buildFinalText, toAgentHistory } from '../../../../src/renderer/pages/Chat/lib/chat-message'
import type { ChatMessage } from '../../../../src/shared/types'

function msg(partial: Partial<ChatMessage> & { role: ChatMessage['role'] }): ChatMessage {
  return { content: '', timestamp: 1000, ...partial }
}

describe('toAgentHistory', () => {
  it('透传原始时间戳(不重置为 now)', () => {
    const out = toAgentHistory([
      msg({ role: 'user', content: '上周的问题', timestamp: 1700000000000 }),
      msg({ role: 'assistant', content: '回答', timestamp: 1700000001000 }),
    ])
    expect(out[0].timestamp).toBe(1700000000000)
    expect(out[1].timestamp).toBe(1700000001000)
  })

  it('user/assistant 基本字段原样保留', () => {
    const out = toAgentHistory([msg({ role: 'user', content: '你好' })])
    expect(out[0]).toEqual({ role: 'user', content: '你好', timestamp: 1000 })
  })

  it('assistant 带工具结果时附加数据快照', () => {
    const out = toAgentHistory([
      msg({
        role: 'assistant',
        content: '张三当前 85 分。',
        toolCalls: [
          {
            id: 'tc_1',
            name: 'eaa_score',
            args: { name: '张三' },
            result: '{"score":85,"risk":"中风险"}',
          },
        ],
      }),
    ])
    expect(out[0].content).toContain('张三当前 85 分。')
    expect(out[0].content).toContain('[本回复依据的工具调用与结果')
    expect(out[0].content).toContain('eaa_score({"name":"张三"})')
    expect(out[0].content).toContain('"score":85')
  })

  it('过滤 success 占位与空结果(无数据价值的不进快照)', () => {
    const out = toAgentHistory([
      msg({
        role: 'assistant',
        content: '回答',
        toolCalls: [
          { id: 'tc_1', name: 'list_dir', args: {}, result: 'success' },
          { id: 'tc_2', name: 'list_dir', args: {}, result: '' },
        ],
      }),
    ])
    expect(out[0].content).not.toContain('[本回复依据的工具调用与结果')
  })

  it('失败的工具调用标注"失败"前缀', () => {
    const out = toAgentHistory([
      msg({
        role: 'assistant',
        content: '查不到',
        toolCalls: [{ id: 'tc_1', name: 'eaa_score', args: { name: '错名' }, result: '查询失败', isError: true }],
      }),
    ])
    expect(out[0].content).toContain('→ 失败: 查询失败')
  })

  it('单条结果超 200 字符截断', () => {
    const out = toAgentHistory([
      msg({
        role: 'assistant',
        content: '回答',
        toolCalls: [{ id: 'tc_1', name: 'eaa_history', args: {}, result: 'x'.repeat(500) }],
      }),
    ])
    expect(out[0].content).toContain(`${'x'.repeat(200)}…`)
    expect(out[0].content).not.toContain('x'.repeat(201))
  })

  it('最多保留 8 条工具快照', () => {
    const calls = Array.from({ length: 12 }, (_, i) => ({
      id: `tc_${i}`,
      name: `tool_${i}`,
      args: {},
      result: `结果${i}`,
    }))
    const out = toAgentHistory([msg({ role: 'assistant', content: '回答', toolCalls: calls })])
    expect(out[0].content).toContain('tool_7')
    expect(out[0].content).not.toContain('tool_8')
  })

  it('长参数压缩到 120 字符(含 JSON 结构前缀)', () => {
    const out = toAgentHistory([
      msg({
        role: 'assistant',
        content: '回答',
        toolCalls: [{ id: 'tc_1', name: 'write_file', args: { content: 'y'.repeat(300) }, result: 'ok' }],
      }),
    ])
    // '{"content":"}' 前缀占 12 字符,120 - 12 = 108 个 y 后截断
    expect(out[0].content).toContain(`${'y'.repeat(108)}…`)
    expect(out[0].content).not.toContain('y'.repeat(120))
  })
})

describe('buildFinalText', () => {
  it('无附件时原样返回', () => {
    expect(buildFinalText('你好', [])).toBe('你好')
  })

  it('Excel 只注入绝对路径，不灌 base64', () => {
    const out = buildFinalText('录入系统', [
      {
        name: '4班.xlsx',
        path: 'C:\\Users\\me\\Downloads\\4班.xlsx',
        size: 4096,
        content: 'UEsDB fake-zip-bytes',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ])
    expect(out).toContain('read_excel')
    expect(out).toContain('C:\\Users\\me\\Downloads\\4班.xlsx')
    expect(out).not.toContain('UEsDB')
    expect(out).not.toContain('<untrusted_file_content>')
  })

  it('文本附件仍注入内容定界', () => {
    const out = buildFinalText('看看', [
      {
        name: 'note.txt',
        path: 'C:\\tmp\\note.txt',
        size: 4,
        content: 'hello',
        mimeType: 'text/plain',
      },
    ])
    expect(out).toContain('<untrusted_file_content>')
    expect(out).toContain('hello')
  })
})
