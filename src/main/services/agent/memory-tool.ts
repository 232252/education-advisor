// =============================================================
// save_memory 工具 — Agent 持久化记忆的写入入口
// 所有 agent 均获得该工具(记忆是通用能力);读取不需要工具 —
// 记忆段落由 memoryService.getMemorySection 在每次运行时自动注入
// system prompt(见 agent/execution.ts)。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { textResult } from '../eaa/tools/shared'
import { memoryService } from './memory-service'

const saveMemoryParams = Type.Object({
  content: Type.String({
    description:
      '要记住的内容(一句话事实或偏好,如"用户偏好简洁的中文回复""张三的家长习惯晚上8点后联系")',
  }),
  category: Type.Optional(
    Type.String({
      description:
        '记忆类别: user_preference(用户偏好) / fact(事实结论) / task(任务备忘),默认 fact',
    }),
  ),
})

/** 创建 save_memory 工具实例(每次运行重建,捕获当次 agentId) */
export function createMemoryTool(agentId: string): AgentTool<typeof saveMemoryParams> {
  return {
    name: 'save_memory',
    label: '保存长期记忆',
    description:
      '把重要信息保存为长期记忆,下次运行时自动加载。适合保存: 用户偏好(称呼、沟通风格、常用操作)、跨会话需要记住的事实结论(如"李四的数学需重点关注")、未完成的任务备忘。不要保存无关紧要的闲聊内容。',
    parameters: saveMemoryParams,
    execute: async (_toolCallId, params) => {
      const category = params.category?.trim() || 'fact'
      try {
        const entry = memoryService.addEntry(agentId, params.content, category)
        return textResult(
          `已保存记忆 [${entry.category}] ${entry.content.slice(0, 100)} — 该记忆将在后续运行中自动加载。`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return textResult(`保存记忆失败: ${msg}`)
      }
    },
  }
}
