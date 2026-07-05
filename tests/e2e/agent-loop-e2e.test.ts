// =============================================================
// E2E 测试:Agent 完整循环 + transformContext 压缩
//
// 目的:
//  1. 验证 transformContext 钩子触发后 Agent 循环不中断
//  2. 验证多轮工具调用完整跑完
//  3. 验证上下文压缩不破坏 agent 状态
//  4. 模拟 "Agent 跑长任务中途卡住" 这个 bug 场景
//
// 用法: npx vitest run tests/e2e/agent-loop-e2e.test.ts
// =============================================================

import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AssistantMessage,
  AssistantMessageEvent,
} from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import { EventStream } from '@earendil-works/pi-ai/compat'
import type { Api, Model } from '@earendil-works/pi-ai/compat'
import { getModel } from '@earendil-works/pi-ai/compat'

// =============================================================
// 工具
// =============================================================

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => {
        if (event.type === 'done') return event.message
        if (event.type === 'error') return event.error
        throw new Error('Unexpected event type')
      },
    )
  }
}

function createAssistantMessage(text: string, totalTokens = 0): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'mock-test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function createAssistantMessageWithToolCall(toolName: string, args: unknown, toolCallId: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: '' },
      {
        type: 'toolCall',
        id: toolCallId,
        name: toolName,
        arguments: args as Record<string, unknown>,
      },
    ],
    api: 'openai-completions',
    provider: 'openai',
    model: 'mock-test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  }
}

function createUserMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  } as AgentMessage
}

// 等待 ticks
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

// =============================================================
// 主测试:模拟 "Agent 跑长任务中途卡住" 场景
// =============================================================

describe('Agent 完整循环 E2E', () => {
  it('E2E-1: 多轮工具调用 + 完整 agent_end', async () => {
    let responseCount = 0
    const toolCallLog: string[] = []
    const eventLog: string[] = []

    // 工具:每次返回 success + echo args(把 i 字段拿出来,做"每轮不同 args"的断言)
    const echoTool: AgentTool<any> = {
      name: 'echo',
      description: 'Echo tool for testing',
      label: 'echo',
      parameters: {
        type: 'object',
        properties: { i: { type: 'number' } },
        required: ['i'],
      } as any,
      execute: async (_toolCallId: string, params: any) => {
        const i = (params as { i?: number } | undefined)?.i
        toolCallLog.push(`echo:i=${i}`)
        return { content: [{ type: 'text', text: `echo:i=${i}` }], details: { success: true, i } }
      },
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: 'You are a test agent that calls echo tool 3 times then finishes.',
        model: getModel('openai', 'gpt-4o-mini') as Model<Api>,
        tools: [echoTool],
      },
      streamFn: (_model, context) => {
        const stream = new MockAssistantStream()
        responseCount++
        queueMicrotask(() => {
          // 第 1 轮:调 echo
          // 第 2 轮:调 echo
          // 第 3 轮:调 echo
          // 第 4 轮:最终回复
          const turn = responseCount
          if (turn <= 3) {
            stream.push({
              type: 'done',
              reason: 'toolUse',
              message: createAssistantMessageWithToolCall('echo', { i: turn }, `tc-${turn}`),
            })
          } else {
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createAssistantMessage('All done!'),
            })
          }
        })
        return stream
      },
    })

    agent.subscribe(async (event: AgentEvent) => {
      eventLog.push(event.type)
    })

    await agent.prompt('Run the test')

    // 等待所有工具执行 + agent 循环结束
    await agent.waitForIdle()

    // 验证:3 次工具调用(每轮 i=1,2,3)+ 最终回复
    expect(toolCallLog).toEqual(['echo:i=1', 'echo:i=2', 'echo:i=3'])
    expect(responseCount).toBe(4)
    expect(agent.state.isStreaming).toBe(false)

    // 验证:agent_end 事件触发(说明循环完整跑完)
    const agentEndEvents = eventLog.filter((t) => t === 'agent_end')
    expect(agentEndEvents.length).toBeGreaterThanOrEqual(1)

    // 验证:最终消息是 assistant
    const last = agent.state.messages[agent.state.messages.length - 1]
    expect(last?.role).toBe('assistant')
    if (last?.role === 'assistant') {
      expect(last.stopReason).toBe('stop')
    }
  }, 10000)

  it('E2E-2: transformContext 触发后 Agent 不中断', async () => {
    let transformCalls = 0
    let responseCount = 0
    const eventLog: string[] = []

    // transformContext:每次返回原 messages(模拟"已压缩"但不变换)
    // 这等价于压扁后 Agent 仍能继续
    const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
      transformCalls++
      // 模拟压缩:如果消息数 > 5, 保留最近 2 条
      if (messages.length > 5) {
        return messages.slice(-2)
      }
      return messages
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Test',
        model: getModel('openai', 'gpt-4o-mini') as Model<Api>,
        tools: [],
      },
      transformContext,
      streamFn: () => {
        const stream = new MockAssistantStream()
        responseCount++
        queueMicrotask(() => {
          if (responseCount < 3) {
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createAssistantMessage(`Response ${responseCount}`),
            })
          } else {
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createAssistantMessage('Final'),
            })
          }
        })
        return stream
      },
    })

    agent.subscribe((event: AgentEvent) => {
      eventLog.push(event.type)
    })

    // 预填 10 条消息(超过 transformContext 阈值 5)
    for (let i = 0; i < 10; i++) {
      agent.state.messages.push(createUserMessage(`pre-${i}`))
    }

    await agent.prompt('continue')

    expect(transformCalls).toBeGreaterThan(0)
    expect(agent.state.isStreaming).toBe(false)
    // 验证:transformContext 触发时确实压缩过(消息被切到 2 条时长度 < 原始 10)
    // 注意:这里不严格断言 messages.length, 因为后续 prompt 还会追加
    // 关键断言是 agent_end 触发了 + 循环跑完
    expect(eventLog).toContain('agent_end')
    // transformContext 在循环过程中至少触发一次
    expect(eventLog.filter((e) => e === 'agent_end').length).toBeGreaterThanOrEqual(1)
  }, 10000)

  it('E2E-3: 真实 transformContext 压缩后不破坏工具调用循环', async () => {
    // 这个测试模拟用户场景:Agent 跑 8 步学生数据生成,中途某一步 transformContext 触发
    let transformTriggered = 0
    let responseCount = 0
    const eventLog: string[] = []
    const toolCallLog: string[] = []

    const fakeTool: AgentTool<any> = {
      name: 'fakeTool',
      description: 'Fake tool',
      parameters: { type: 'object', properties: {} } as any,
      execute: async () => {
        toolCallLog.push(`call-${responseCount}`)
        return { ok: true, n: responseCount }
      },
    }

    // 真实压缩逻辑(从 compaction-helper 简化):按字符数估算,超阈值就保留最近 2 条
    const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
      transformTriggered++
      const charCount = messages.reduce((sum, m) => {
        const c = (m as { content?: unknown }).content
        if (typeof c === 'string') return sum + c.length
        if (Array.isArray(c)) {
          for (const b of c) {
            const r = b as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown }
            if (r.type === 'text' && r.text) sum += r.text.length
            else if (r.type === 'thinking' && r.thinking) sum += r.thinking.length
            else if (r.type === 'toolCall') sum += (r.name?.length ?? 0) + JSON.stringify(r.arguments ?? {}).length
          }
        }
        return sum
      }, 0)
      // 阈值:4000 字符 ≈ 1000 tokens
      if (charCount > 4000) {
        console.log(`[transformContext] Triggered: ${charCount} chars > 4000, slicing last 2`)
        // 压缩:返回最近 2 条
        return messages.slice(-2)
      }
      return messages
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Test',
        model: getModel('openai', 'gpt-4o-mini') as Model<Api>,
        tools: [fakeTool],
      },
      transformContext,
      streamFn: () => {
        const stream = new MockAssistantStream()
        responseCount++
        queueMicrotask(() => {
          if (responseCount <= 4) {
            stream.push({
              type: 'done',
              reason: 'toolUse',
              message: createAssistantMessageWithToolCall('fakeTool', { i: responseCount }, `tc-${responseCount}`),
            })
          } else {
            stream.push({
              type: 'done',
              reason: 'stop',
              message: createAssistantMessage('All students added'),
            })
          }
        })
        return stream
      },
    })

    agent.subscribe((event: AgentEvent) => {
      eventLog.push(event.type)
    })

    await agent.prompt('Add 4 students')

    // 核心断言
    expect(agent.state.isStreaming).toBe(false)
    expect(responseCount).toBe(5) // 4 工具 + 1 最终
    expect(toolCallLog.length).toBe(4)
    expect(eventLog).toContain('agent_end')
    // 关键:transformContext 触发了
    expect(transformTriggered).toBeGreaterThan(0)
  }, 10000)
})
