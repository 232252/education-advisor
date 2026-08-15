// =============================================================
// feishu-bot/agent-runner — 默认 Agent 执行与回复收集
// 从 feishu-bot-service.ts 拆出(纯重构,行为不变)
// =============================================================

import { formatLlmError } from '@shared/llm-error'
import type { BrowserWindow } from 'electron'
import { log } from '../../utils/logger'
import { agentService } from '../agent-service'
import { DEFAULT_AGENT_ID } from './constants'

/**
 * 运行默认 Agent 并收集完整回复文本。
 * runAgent 直接返回本次执行的 AgentExecution(不再从 executionHistory 猜最后一条,
 * 避免排队/并发时取到别的运行结果)。
 */
export async function runAgentAndCollect(
  prompt: string,
  win: BrowserWindow | null,
): Promise<string> {
  // 选用默认 main agent;若不存在则用第一个 enabled 的 agent
  const agents = agentService.listAgents().filter((a) => a.enabled)
  const target = agents.find((a) => a.id === DEFAULT_AGENT_ID) ?? agents[0]
  if (!target) {
    return '当前没有可用的 Agent,请先在 Agent 管理中启用一个。'
  }

  try {
    // win 可能为 null(无窗口场景);runAgent 内部 sendStatus 对 null/已销毁窗口是安全的
    const execution = await agentService.runAgent(target.id, prompt, win as BrowserWindow)
    if (!execution) return '(执行已被中止)'
    if (execution.status !== 'success') {
      // 美化原始 provider 错误(如 "429 {...JSON...}"),远程用户看到的是可读文本
      return `Agent 执行出错: ${formatLlmError(execution.output || '未知错误')}`
    }
    return execution.output || '(Agent 返回空内容)'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'feishu-bot', `agent run failed for ${target.id}: ${msg}`)
    // runAgent 抛错时(如 agent disabled/排队已满)也尝试从 history 取错误输出
    const history = agentService.getHistory(target.id)
    const last = history[history.length - 1]
    if (last?.output) return `执行失败: ${last.output}`
    return `执行失败: ${msg}`
  }
}
