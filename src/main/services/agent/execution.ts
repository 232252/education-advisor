// =============================================================
// Agent 单次执行流程 — 编排骨干
// （从 AgentService.executeRun 抽出；M16 进一步拆分纯逻辑:
//   agent/system-prompt.ts   系统提示词拼接(纯函数)
//   agent/event-collector.ts 事件订阅 → 输出/token/turn 聚合器
//   agent/continuation.ts    isNonRetryableError + 智能续跑循环
// 本文件保留: 选模型 → 建实例 → 接线 → 落库 → 清理 的编排链路;
// 日志前缀与事件负载逐字保留,行为零变化)
// =============================================================

import type {
  AgentMessage,
  AgentTool,
  CompactionSettings,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentExecution } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { log } from '../../utils/logger'
import { resolveApiKey, selectModel } from '../agent-model-selector'
import {
  compactAgentMessages,
  computeAdaptiveReserve,
  estimateMessageChars,
} from '../compaction-helper'
import { dbService } from '../db-service'
import { ollamaService } from '../ollama-service'
import { settingsService } from '../settings-service'
import { runContinuationLoop } from './continuation'
import { createEventCollector } from './event-collector'
import { sendAgentStatus } from './status-tracking'
import { buildSystemPrompt } from './system-prompt'
import { withTimeout } from './timeout'
import type { AgentExecutionDeps } from './types'

/**
 * 实际执行一次 Agent 运行(由 runAgent 队列串行调用),返回执行记录(含真实 status)
 */
export async function executeAgentRun(
  deps: AgentExecutionDeps,
  id: string,
  prompt: string,
  win: BrowserWindow,
  history?: Array<{ role: string; content: string }>,
  generation?: number,
): Promise<AgentExecution | undefined> {
  const config = deps.getConfig(id)
  if (!config) {
    const msg = `Agent not found: ${id}`
    sendAgentStatus(win, id, 'error', { error: msg })
    throw new Error(msg)
  }
  if (!config.enabled) {
    // 排队期间被停用 → 与 runAgent 入口行为一致
    const msg = `Agent is disabled: ${id}`
    deps.setStatus(id, 'error')
    sendAgentStatus(win, id, 'error', { error: msg })
    throw new Error(msg)
  }

  // 选择模型
  // P0-2: ollama 等本地 keyless provider 的已安装列表需异步预取
  // (selectModel 是同步纯函数,无法内部 await ollamaService.listModels)
  let ollamaModelIds: string[] | undefined
  if (settingsService.getSettings().models.defaultProvider === 'ollama') {
    const installed = await ollamaService.listModels()
    ollamaModelIds = installed.map((m) => m.name)
  }
  const model = selectModel(config.modelTier, ollamaModelIds)
  const apiKeyResolved = resolveApiKey(model.provider)
  console.log(
    `[AgentService] runAgent(${id}) model selected: ${model.provider}/${model.id} (api: ${model.api}, baseUrl: ${model.baseUrl}, apiKey: ${apiKeyResolved ? '***present***' : 'MISSING'})`,
  )

  // 选择工具(三层 MCP 合并,抽出为 buildAgentTools 方法)
  // M32: 传入 win — main 的 delegate_to 委托运行需复用该窗口推送状态
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  const tools: AgentTool<any>[] = await deps.buildAgentTools(config, id, win)

  // MEDIUM-2 修复: 启动竞态窗口 — buildAgentTools 等 await 期间 runningAgents 尚未注册,
  // 此窗口内的 abortAgent 靠"无条件递增 generation"生效,此处出 await 后立即检查。
  if (generation !== undefined && !deps.isCurrentGeneration(id, generation)) {
    console.log(`[AgentService] runAgent(${id}) aborted during startup, skip`)
    return undefined
  }

  // ✅ [Settings wiring] 读取 chat.* 设置
  // steeringMode/followUpMode/showImages 没有运行时 API 等价物,注入到 system prompt 顶部
  // compaction 有运行时钩子(transformContext),走真正的 LLM 摘要压缩
  const chatSettings = settingsService.getSettings().chat

  // M15: waitForIdle 超时从 settings.general.agentTimeoutMins 读取(分钟,-1 不限)。
  // 此前 5 分钟硬编码(WAIT_FOR_IDLE_TIMEOUT_MS 常量),多工具长任务(批量 Excel 处理)
  // 被误杀。默认 5 分钟与原常量语义一致;非法值(<=0 且非 -1)回退默认 5 分钟。
  // idleTimeoutMs === null 表示不限(waitIdle 包装函数在 agent 实例创建后定义)。
  const timeoutMins = settingsService.getSettings().general.agentTimeoutMins
  const idleTimeoutMs =
    timeoutMins === -1 ? null : timeoutMins > 0 ? timeoutMins * 60_000 : 5 * 60_000
  const steeringMode = chatSettings?.steeringMode ?? 'all'
  const followUpMode = chatSettings?.followUpMode ?? 'all'
  const showImages = chatSettings?.showImages ?? true
  const compactionEnabled = chatSettings?.compaction?.enabled ?? true
  const compactionReserve = chatSettings?.compaction?.reserveTokens ?? 8000
  const compactionKeep = chatSettings?.compaction?.keepRecentTokens ?? 16000
  console.log(
    `[AgentService] runAgent(${id}) chat config: steering=${steeringMode} followUp=${followUpMode} showImages=${showImages} compaction=${compactionEnabled ? 'on' : 'off'} reserve=${compactionReserve} keepRecent=${compactionKeep}`,
  )

  // 构造 system prompt (含 SOUL + 公共规则 + 角色 Rules + Skills + 转向/后续/图片设置)
  // 注意:此处先拼好,后面会被 systemPrompt setter 覆盖
  // M10: 公共规则(agents/_shared/rules.md)单点注入,角色 AGENTS.md 只保留角色差异段
  // M16: 模板拼接拆到 agent/system-prompt.ts(纯函数)
  const systemPrompt = buildSystemPrompt({
    config: { name: config.name, role: config.role, description: config.description },
    soulContent: deps.getSoulContent(id),
    sharedRulesContent: deps.getSharedRulesContent(),
    rulesContent: deps.getRulesContent(id),
    skillsSection: deps.buildSkillsSection(),
    steeringMode,
    followUpMode,
    showImages,
  })

  // 压缩设置(供 transformContext 使用)
  // 修复 Bug-2: reserveTokens 上限按 model.contextWindow 自适应(默认 10% 上下文,至少 4096)
  // 实现提取到 compaction-helper.computeAdaptiveReserve(与 Chat 链路共用)
  const adaptiveReserve = computeAdaptiveReserve(compactionReserve, model.contextWindow)
  const compactionSettings: CompactionSettings = {
    enabled: compactionEnabled,
    reserveTokens: adaptiveReserve,
    keepRecentTokens: compactionKeep,
  }
  console.log(
    `[AgentService] runAgent(${id}) compaction settings: reserve=${adaptiveReserve} (model.contextWindow=${model.contextWindow})`,
  )

  // 创建 Agent 实例 - transformContext 钩子在每次循环前触发压缩
  // 触发条件: messages 总 token > contextWindow - reserveTokens (即 contextWindow 的 90%)
  // 行为: 调 LLM 对旧消息生成结构化摘要,替换为单条 summary 消息,保留近期消息原样
  const abortController = new AbortController()
  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    // 防御:这些已经在 helper 内部检查过,这里只保证 settings 合法
    if (!compactionSettings.enabled) {
      return messages
    }
    if (messages.length <= 2) {
      return messages
    }
    // R136 优化: 廉价预检查 — 字符总数 / 4 < 阈值 * 0.8 时跳过完整扫描
    // 避免每轮都对全部消息做 O(N) token 估算(常见于会话初期)
    // (M16: 统计规则收敛到 compaction-helper.estimateMessageChars,此处是第三个消费方)
    const threshold = model.contextWindow - compactionSettings.reserveTokens
    let quickChars = 0
    for (let i = 0; i < messages.length; i++) {
      quickChars += estimateMessageChars(messages[i])
      // 提前退出: 已超阈值 * 0.8 就停止统计, 进入完整评估
      if (quickChars / 4 > threshold * 0.8) break
    }
    if (quickChars / 4 < threshold * 0.8) {
      return messages
    }
    const key = resolveApiKey(model.provider)
    if (!key) {
      console.warn('[AgentService] compaction skipped: no API key for', model.provider)
      return messages
    }
    try {
      const result = await compactAgentMessages(
        messages,
        model,
        compactionSettings,
        key,
        abortController.signal,
      )
      if (result.length < messages.length) {
        console.log(
          `[AgentService] compaction applied: ${messages.length} → ${result.length} messages`,
        )
      }
      return result
    } catch (err) {
      console.warn('[AgentService] compaction failed (non-fatal):', err)
      return messages
    }
  }

  const agent = new Agent({
    // pi-agent-core 0.84: streamFn 必填(旧版可选),显式传入 pi-ai 的流式实现
    streamFn: streamSimple,
    initialState: {
      systemPrompt,
      model,
      // C-2 修复: 从 settings.chat.thinkingLevel 读取用户选择的思考级别,
      // 而非硬编码 'medium'。fallback 到 'medium' 保证向后兼容。
      thinkingLevel: (settingsService.getSettings().chat?.thinkingLevel ??
        'medium') as ThinkingLevel,
      // ✅ 从模型定义中读取 maxTokens 作为单次输出上限
      // (pi-agent-core 会根据 model.maxTokens 向 LLM 请求对应数量的 token)
    },
    getApiKey: (provider: string) => resolveApiKey(provider),
    transformContext,
    // 诊断: 捕获 LLM HTTP 响应状态码和 headers,用于定位 stopReason=error 的根因
    // 走正式 logger(debug 级别),仅当 logLevel=debug 时落盘,避免在普通用户机器上 ENOENT 噪音
    onResponse: (response, modelUsed) => {
      try {
        log(
          'debug',
          'agent',
          `HTTP_RESPONSE: model=${modelUsed.provider}/${modelUsed.id} status=${response.status} headers=${JSON.stringify(response.headers)}`,
        )
      } catch {
        // ignore
      }
    },
  })

  // 设置工具
  agent.state.tools = tools
  const startedAt = Date.now()

  // M15: waitForIdle 的超时包装(null = 不限,直接等待,避免 setTimeout(Infinity) 立即触发)
  const waitIdle = (label: string): Promise<void> =>
    idleTimeoutMs === null
      ? agent.waitForIdle()
      : withTimeout(agent.waitForIdle(), idleTimeoutMs, label)

  // 记录运行时实例
  deps.setRunning(id, { agent, abortController, agentId: id, startedAt })

  // M16: 事件收集器(输出/token/turn 聚合 + 渲染进程状态转发,实现拆到 event-collector.ts)
  const collector = createEventCollector(win, id)
  const { stats } = collector

  // M-4 修复: 声明 dbExecId 在 try 外(供 catch 使用),赋值移入 try 内
  // 之前 recordExecutionStart 在 try-catch 外,若 DB 抛错会导致 agent 状态卡死、unsubscribe 泄漏
  let dbExecId = -1

  const unsubscribe = agent.subscribe(collector.handler)

  // ── 注入对话历史（让 Agent 拥有完整上下文）──
  // pi-agent-core 的 runAgentLoop 会将 state.messages + 新 prompt 合并后发给 LLM
  // 因此这里把前端传来的聊天历史转为 AgentMessage[] 并注入 state.messages
  if (history && history.length > 0) {
    const historyMessages: AgentMessage[] = []
    for (const msg of history) {
      if (!msg.content) continue
      if (msg.role === 'user') {
        historyMessages.push({
          role: 'user' as const,
          content: msg.content,
          timestamp: Date.now(),
        })
      } else if (msg.role === 'assistant') {
        historyMessages.push({
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: msg.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        })
      }
      // system / toolResult 等角色跳过 — 不影响核心对话语义
    }
    if (historyMessages.length > 0) {
      agent.state.messages = historyMessages
      console.log(
        `[AgentService] runAgent(${id}) injected ${historyMessages.length} history messages (${history.length} raw)`,
      )
    }
  }

  try {
    // M-4 修复: recordExecutionStart 移入 try 块,DB 抛错时走 catch 清理流程
    dbExecId = dbService.recordExecutionStart(id, prompt)
    // MEDIUM 修复: running 状态设置移入 try 块,避免 setup 阶段抛错导致状态永久卡死
    deps.setStatus(id, 'running')
    sendAgentStatus(win, id, 'running')
    // ── 执行 Agent（含智能续跑）──
    console.log(`[AgentService] runAgent(${id}) calling agent.prompt()...`)
    // 诊断(走 logger debug): 记录 prompt 调用前的 model/apiKey/tools 状态
    log(
      'debug',
      'agent',
      `runAgent(${id}) calling agent.prompt(), model=${model.provider}/${model.id}, apiKey=${apiKeyResolved ? 'present' : 'MISSING'}, tools=${tools.length}`,
    )
    await agent.prompt(prompt)
    console.log(`[AgentService] runAgent(${id}) prompt() resolved, waiting for idle...`)
    log('debug', 'agent', `runAgent(${id}) prompt() resolved, waiting for idle...`)
    await waitIdle(`Agent waitForIdle(${id})`)
    console.log(
      `[AgentService] runAgent(${id}) first pass: turns=${stats.turnCount} outputLen=${stats.outputText.length} toolCalls=${stats.toolCallCount}`,
    )
    log(
      'debug',
      'agent',
      `runAgent(${id}) first pass done: turns=${stats.turnCount} outputLen=${stats.outputText.length} toolCalls=${stats.toolCallCount}`,
    )

    // ── 智能续跑循环 ──
    // 当模型过早结束（输出短 AND 轮次少）时，发送续跑提示让模型继续完成任务
    // 优化: 当 LLM 返回 429(rate_limit) / 401(auth) / 403(forbidden) 等不可重试错误时,跳过续跑
    // 避免对已限流/鉴权失败的账户继续发起无意义的 API 调用
    // (M16: 循环实现拆到 agent/continuation.ts)
    const continuationCount = await runContinuationLoop({
      id,
      prompt: (text) => agent.prompt(text),
      waitIdle,
      getOutputLength: () => stats.outputText.length,
      getTurnCount: () => stats.turnCount,
      getLastErrorMessage: () => stats.lastErrorMessage,
      isAborted: () => abortController.signal.aborted,
    })
    if (continuationCount > 0) {
      console.log(
        `[AgentService] runAgent(${id}) total continuations: ${continuationCount}, final outputLen=${stats.outputText.length}`,
      )
    }
    console.log(`[AgentService] runAgent(${id}) idle, output length=${stats.outputText.length}`)

    // 优化: 当输出为空且 LLM 返回了错误时,标记为 error 而非 success
    // 此前 stopReason=error 的空输出被标记为 success,用户看不到任何错误提示
    const hasError = stats.outputText.length === 0 && !!stats.lastErrorMessage
    const finalStatus: AgentExecution['status'] = hasError ? 'error' : 'success'
    const finalOutput = stats.outputText || (hasError ? `[LLM 错误] ${stats.lastErrorMessage}` : '')

    // 记录执行历史
    const execution: AgentExecution = {
      id: `exec_${Date.now()}`,
      agentId: id,
      prompt,
      output: finalOutput,
      startedAt,
      durationMs: Date.now() - startedAt,
      tokenUsage: {
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      cost: stats.totalCost,
      status: finalStatus,
    }
    deps.appendExecution(id, execution)

    // 同步写入 DB
    if (dbExecId >= 0) {
      dbService.updateExecution(dbExecId, {
        status: hasError ? 'failure' : 'success',
        output: finalOutput,
        error: hasError ? stats.lastErrorMessage : undefined,
        tokensInput: stats.inputTokens,
        tokensOutput: stats.outputTokens,
        costTotal: stats.totalCost,
      })
    }

    // 更新状态
    if (hasError) {
      deps.setStatus(id, 'error')
      sendAgentStatus(win, id, 'error', { error: stats.lastErrorMessage, result: execution })
    } else {
      deps.setStatus(id, 'idle')
      sendAgentStatus(win, id, 'idle', { result: execution })
    }
    return execution
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    // 诊断(走 logger): 错误用 warn 级别确保可见,附带 stack 定位
    log(
      'warn',
      'agent',
      `runAgent(${id}) CAUGHT ERROR: ${errorMsg}\nstack: ${err instanceof Error ? err.stack : 'no stack'}`,
    )
    const isAborted = abortController.signal.aborted
    // M15 修复: waitForIdle 超时抛 "xxx timed out after XXXms",但此时
    // abortController 尚未 abort(finally 块才 abort),isAborted=false,
    // 导致超时被错标为 error。timeout 与 error 是不同的运维信号
    // (前者要调超时/拆任务,后者要修 bug),错标会误导排查方向。
    const isTimeout = !isAborted && /timed out/i.test(errorMsg)
    // R170 修复: error 时 output 必须保留 errorMsg,即使已有部分输出。
    // 此前 outputText || errorMsg 在"部分输出 + 中途 429/quota"场景丢失错误关键词,
    // cron 熔断器 isQuotaError 匹配不到 output,配额耗尽后 cron 继续空转。
    const catchOutput = stats.outputText ? `${stats.outputText}\n[error] ${errorMsg}` : errorMsg
    const execution: AgentExecution = {
      id: `exec_${Date.now()}`,
      agentId: id,
      prompt,
      output: catchOutput,
      startedAt,
      durationMs: Date.now() - startedAt,
      tokenUsage: {
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      cost: stats.totalCost,
      status: isAborted || isTimeout ? 'timeout' : 'error',
    }
    deps.appendExecution(id, execution)

    // 同步写入 DB
    // (DB schema CHECK(status IN ('running','success','failure','aborted')) 不含
    // 'timeout',沿用既有 abort 路径的映射: 内存 'timeout' → DB 'aborted')
    if (dbExecId >= 0) {
      dbService.updateExecution(dbExecId, {
        status: isAborted || isTimeout ? 'aborted' : 'failure',
        output: catchOutput,
        error: errorMsg,
        tokensInput: stats.inputTokens,
        tokensOutput: stats.outputTokens,
        costTotal: stats.totalCost,
      })
    }

    // High 5.4 修复: abortAgent 与 runAgent finally 双重状态转移
    // 之前无论是 abort 还是真实 error 都设 'error' 状态,
    // 但 abortAgent 之后又会设 'idle',导致状态从 error 翻转为 idle,前端收到矛盾事件
    // 修复: 如果是 abort 导致的,不设 error 状态(让 abortAgent 统一设 idle);
    // 只在真实 error 时设 error 状态
    if (!isAborted) {
      deps.setStatus(id, 'error')
      sendAgentStatus(win, id, 'error', { error: errorMsg })
    }
    // abort 路径: 不在此处发状态事件,由 abortAgent 统一发送 idle + aborted: true
    return execution
  } finally {
    // 修复: finally 块中 abort,确保 agent 异常退出(如 waitForIdle 超时)后
    // 不再继续消耗 API token。abort() 是幂等的,已被 abortAgent 调用过时再调是 no-op。
    // 必须在 catch 块处理完之后再 abort(catch 中检查 isAborted 区分 abort 和真实 error)。
    if (!abortController.signal.aborted) {
      abortController.abort()
      try {
        await agent.abort()
      } catch {
        /* agent.abort 可能因已停止而抛错,忽略 */
      }
    }
    unsubscribe()
    deps.deleteRunning(id)
  }
}
