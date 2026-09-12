// =============================================================
// channels/bridge/agent-runner — 渠道侧 Agent 执行与回复收集
// (M3 从 feishu-bot/agent-runner.ts 上提到 Bridge,行为不变)
// 阶段 0: runAgentStreaming 订阅 agent-events 的输出增量
// (渲染窗口流式的进程内镜像),驱动流式回复;不改变 Agent 内核。
// runAgentAndCollect 保留(斜杠命令上下文仍用整段收集)。
// M0: ① runAgent 标记 source='channel'(UI abort 来源隔离);
//     ② 执行被中止时返回"任务被中止"提示,不再把半截话当完整回复;
//     ③ 长工具调用期间追加"正在执行第 N 步"进展行,
//        下一段文本增量到达后自动消失(全量文本语义,不污染终稿)。
// =============================================================

import { formatLlmError } from '@shared/llm-error'
import type { BrowserWindow } from 'electron'
import { errText } from '../../../utils/err-text'
import { log } from '../../../utils/logger'
import { agentEvents } from '../../agent/agent-events'
import { agentService } from '../../agent-service'

/** 默认绑定 Agent(main);各渠道可在设置里覆盖(M4: channels.<id>.agentId) */
const DEFAULT_AGENT_ID = 'main'

/** 选用 Agent:优先渠道绑定的 agentId,回退 main,再回退第一个 enabled */
function pickAgent(preferredAgentId?: string): { id: string } | undefined {
  const agents = agentService.listAgents().filter((a) => a.enabled)
  if (preferredAgentId) {
    const preferred = agents.find((a) => a.id === preferredAgentId)
    if (preferred) return preferred
  }
  return agents.find((a) => a.id === DEFAULT_AGENT_ID) ?? agents[0]
}

/** Agent 状态事件负载(进程内镜像,见 agent/status-tracking.ts) */
interface AgentStatusEvent {
  agentId: string
  status: string
  output?: unknown
  toolCall?: { name: string } | null
}

/** 执行记录 → 渠道侧回复文本(中止/出错/正常三态) */
function executionToReply(execution: { status: string; output: string } | undefined): string {
  if (!execution) return '(执行已被中止)'
  // M0: abort 不再伪装 success — 用明确的中止提示,不把半截输出当结果
  if (execution.status === 'aborted') {
    return '⚠️ 任务被中止了(可能被本机停止或超时)。重新发一次消息,我会继续处理。'
  }
  if (execution.status !== 'success') {
    // 美化原始 provider 错误(如 "429 {...JSON...}"),远程用户看到的是可读文本
    return `Agent 执行出错: ${formatLlmError(execution.output || '未知错误')}`
  }
  return execution.output || '(Agent 返回空内容)'
}

/**
 * 运行 Agent 并收集完整回复文本。
 * runAgent 直接返回本次执行的 AgentExecution(不从 executionHistory 猜最后一条,
 * 避免排队/并发时取到别的运行结果)。
 * @param preferredAgentId 渠道绑定的 Agent(缺省 main → 第一个 enabled)
 */
export async function runAgentAndCollect(
  prompt: string,
  win: BrowserWindow | null,
  preferredAgentId?: string,
): Promise<string> {
  const target = pickAgent(preferredAgentId)
  if (!target) {
    return '当前没有可用的 Agent,请先在 Agent 管理中启用一个。'
  }

  try {
    // win 可能为 null(无窗口场景);runAgent 内部 sendStatus 对 null/已销毁窗口是安全的
    const execution = await agentService.runAgent(
      target.id,
      prompt,
      win as BrowserWindow,
      undefined,
      'channel',
    )
    return executionToReply(execution)
  } catch (err) {
    const msg = errText(err)
    log('error', 'channel-bridge', `agent run failed for ${target.id}: ${msg}`)
    // runAgent 抛错时(如 agent disabled/排队已满)也尝试从 history 取错误输出
    const history = agentService.getHistory(target.id)
    const last = history[history.length - 1]
    if (last?.output) return `执行失败: ${last.output}`
    return `执行失败: ${msg}`
  }
}

/** 轮间进展的静默门槛:文本增量静默超过该时长,才在回复载体上显示工具进展行 */
const TOOL_PROGRESS_SILENCE_MS = 3000

/**
 * 运行 Agent,流式回调累计文本。
 * @param onChunk 收到累计全量文本(CardKit/钉钉 streamingUpdate 语义:全量,非增量)
 * 安全性:同一 agent 的运行被 AgentRunQueue 串行化,订阅窗口内
 * 该 agentId 的增量必属于本次运行(见 agent-events.ts 注释)。
 */
export async function runAgentStreaming(
  prompt: string,
  win: BrowserWindow | null,
  onChunk: (accumulatedText: string) => void,
  preferredAgentId?: string,
): Promise<string> {
  const target = pickAgent(preferredAgentId)
  if (!target) {
    return '当前没有可用的 Agent,请先在 Agent 管理中启用一个。'
  }

  let acc = ''
  let lastTextAt = 0
  let toolStep = 0
  const listener = (payload: AgentStatusEvent): void => {
    if (payload.agentId !== target.id || payload.status !== 'running') return
    if (typeof payload.output === 'string' && payload.output) {
      acc += payload.output
      lastTextAt = Date.now()
      onChunk(acc)
      return
    }
    // M0-③: 长静默期的工具调用 → 回复载体追加进展行(全量语义,下段文本到达即消失)
    if (
      payload.toolCall?.name &&
      acc.length > 0 &&
      Date.now() - lastTextAt > TOOL_PROGRESS_SILENCE_MS
    ) {
      toolStep += 1
      onChunk(`${acc}\n\n> ⏳ 正在执行第 ${toolStep} 步(调用工具 ${payload.toolCall.name})…`)
    }
  }
  agentEvents.on('status', listener)
  try {
    const execution = await agentService.runAgent(
      target.id,
      prompt,
      win as BrowserWindow,
      undefined,
      'channel',
    )
    return executionToReply(execution)
  } catch (err) {
    const msg = errText(err)
    log('error', 'channel-bridge', `agent run failed for ${target.id}: ${msg}`)
    const history = agentService.getHistory(target.id)
    const last = history[history.length - 1]
    if (last?.output) return `执行失败: ${last.output}`
    return `执行失败: ${msg}`
  } finally {
    agentEvents.off('status', listener)
  }
}
