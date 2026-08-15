// =============================================================
// Agent 单次执行流程 — 工具循环/流式回调/压缩/智能续跑/中止处理
// （从 AgentService.executeRun 抽出，纯重构零行为变化；
//   this 状态访问改为 deps 注入，日志前缀与事件负载逐字保留）
// =============================================================

import type {
  AgentEvent,
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
import {
  MAX_CONTINUATIONS,
  MIN_OUTPUT_CHARS,
  MIN_TURN_COUNT,
  resolveApiKey,
  selectModel,
} from '../agent-model-selector'
import { compactAgentMessages, computeAdaptiveReserve } from '../compaction-helper'
import { dbService } from '../db-service'
import { ollamaService } from '../ollama-service'
import { settingsService } from '../settings-service'
import { WAIT_FOR_IDLE_TIMEOUT_MS } from './run-queue'
import { sendAgentStatus } from './status-tracking'
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
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  const tools: AgentTool<any>[] = await deps.buildAgentTools(config, id)

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
  const steeringMode = chatSettings?.steeringMode ?? 'all'
  const followUpMode = chatSettings?.followUpMode ?? 'all'
  const showImages = chatSettings?.showImages ?? true
  const compactionEnabled = chatSettings?.compaction?.enabled ?? true
  const compactionReserve = chatSettings?.compaction?.reserveTokens ?? 8000
  const compactionKeep = chatSettings?.compaction?.keepRecentTokens ?? 16000
  console.log(
    `[AgentService] runAgent(${id}) chat config: steering=${steeringMode} followUp=${followUpMode} showImages=${showImages} compaction=${compactionEnabled ? 'on' : 'off'} reserve=${compactionReserve} keepRecent=${compactionKeep}`,
  )

  // 构造 system prompt (含 SOUL + Rules + Skills + 转向/后续/图片设置)
  // 注意:此处先拼好,后面会被 systemPrompt setter 覆盖
  const soulContent = deps.getSoulContent(id)
  const rulesContent = deps.getRulesContent(id)
  const skillsSection = deps.buildSkillsSection()
  const baseSystemPrompt = [
    soulContent || `你是 ${config.name}，角色: ${config.role}。${config.description}`,
    skillsSection,
    rulesContent ? `\n--- 规则 ---\n${rulesContent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const systemPrompt =
    `${baseSystemPrompt}\n\n--- 运行环境 ---\n` +
    `你运行在用户的 **本地桌面应用**（Electron）中，**不是沙箱**，**不是云端**。你拥有完整的本地文件系统读写权限。\n` +
    `你可以用以下工具直接操作本地文件和系统：\n` +
    `| 工具 | 作用 |\n` +
    `|:-----|:-----|\n` +
    `| \`read_file\` | 读取本地文本文件（.txt, .md, .csv, .json 等） |\n` +
    `| \`read_excel\` | 读取本地 Excel 文件（.xlsx/.xls），返回表头和数据行 |\n` +
    `| \`write_file\` | 将文本内容写入本地文件（自动创建目录） |\n` +
    `| \`write_excel\` | 创建 Excel 文件并写入工作表、表头和数据行 |\n` +
    `| \`write_csv\` | 创建 CSV 文件（UTF-8-BOM，Excel 中文不乱码） |\n` +
    `| \`list_dir\` | 列出目录下的文件和子目录 |\n` +
    `| \`get_current_time\` | 获取当前日期、时间、星期几、是否工作日 |\n` +
    `| \`calculate\` | 计算数学表达式（加减乘除、括号、百分比） |\n` +
    `**重要**：当用户让你处理文件（读取、修改、创建 Excel/CSV/文本），直接调用上述工具完成，不要说"我无法写入文件"或"这是沙箱环境"。\n\n` +
    `--- 工作准则 ---\n` +
    `1. 你必须完整执行用户请求的全部任务，不要只回复一句概述就停止。\n` +
    `2. 积极使用可用工具执行实际操作（查询、添加、修改、读写文件、计算等），而不是仅描述你"打算"做什么。\n` +
    `3. 每一步都调用工具获取真实数据，直到任务全部完成后再给出总结。\n` +
    `4. 如果任务涉及多条数据的批量操作，逐条执行，不要中途停下。\n` +
    `5. 当用户让你修改 Excel 文件时：先 read_excel 读取 → 用 calculate 计算 → 用 write_excel 写回新文件。\n` +
    `6. 需要知道"今天几号"、"星期几"时，调用 get_current_time，不要猜测。\n\n` +
    `--- 对话配置 ---\n转向模式: ${steeringMode}\n后续模式: ${followUpMode}\n显示图片: ${showImages ? '是' : '否'}`

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
    const threshold = model.contextWindow - compactionSettings.reserveTokens
    let quickChars = 0
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (!m) continue
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') quickChars += content.length
      else if (Array.isArray(content)) {
        for (const b of content as Array<{ type?: string; text?: string; thinking?: string }>) {
          if (b?.type === 'text' && b.text) quickChars += b.text.length
          else if (b?.type === 'thinking' && b.thinking) quickChars += b.thinking.length
        }
      }
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

  // 记录运行时实例
  deps.setRunning(id, { agent, abortController, agentId: id, startedAt })

  // 收集输出 + 诊断计数
  let outputText = ''
  let inputTokens = 0
  let outputTokens = 0
  let totalCost = 0
  let turnCount = 0
  let toolCallCount = 0
  // 跟踪 LLM 返回的最后一个错误(用于续跑判断 + 最终状态/用户提示)
  let lastErrorMessage = ''

  // M-4 修复: 声明 dbExecId 在 try 外(供 catch 使用),赋值移入 try 内
  // 之前 recordExecutionStart 在 try-catch 外,若 DB 抛错会导致 agent 状态卡死、unsubscribe 泄漏
  let dbExecId = -1

  // 订阅事件，转发到渲染进程 + 收集诊断信息
  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'message_update': {
        const aEvent = event.assistantMessageEvent
        if (aEvent && aEvent.type === 'text_delta') {
          outputText += aEvent.delta
          sendAgentStatus(win, id, 'running', { output: aEvent.delta })
        }
        // 诊断: 记录非 text_delta 的 message_update 事件类型(走 logger,debug 级别)
        if (aEvent && aEvent.type !== 'text_delta') {
          try {
            log(
              'debug',
              'agent',
              `MSG_UPDATE: type=${aEvent.type} keys=${Object.keys(aEvent).join(',')}`,
            )
          } catch {
            // ignore
          }
        }
        break
      }
      case 'tool_execution_start':
        toolCallCount++
        console.log(`[AgentService] agent(${id}) turn=${turnCount} tool_start: ${event.toolName}`)
        sendAgentStatus(win, id, 'running', {
          toolCall: { name: event.toolName, args: event.args },
        })
        break
      case 'tool_execution_end':
        console.log(
          `[AgentService] agent(${id}) turn=${turnCount} tool_end: ${event.toolName} error=${event.isError}`,
        )
        sendAgentStatus(win, id, 'running', {
          toolResult: { name: event.toolName, isError: event.isError },
        })
        break
      case 'turn_end': {
        turnCount++
        const msg = event.message as {
          stopReason?: string
          errorMessage?: string
          content?: Array<{ type?: string; text?: string }>
        }
        const tcInTurn = Array.isArray(msg?.content)
          ? msg.content.filter((c) => c.type === 'toolCall').length
          : 0
        console.log(
          `[AgentService] agent(${id}) turn ${turnCount} ended: stopReason=${msg?.stopReason ?? '?'} tools=${tcInTurn} outputLen=${outputText.length} errorMessage=${msg?.errorMessage ?? 'none'}`,
        )
        // 捕获/清除 LLM 错误信息(用于续跑判断 + 最终状态/用户提示)
        // 修复: 非 error 的 turn 要清除旧错误,避免 stale error 导致 false-positive hasError
        if (msg?.stopReason === 'error' && msg.errorMessage) {
          lastErrorMessage = msg.errorMessage
        } else if (msg?.stopReason && msg.stopReason !== 'error') {
          lastErrorMessage = ''
        }
        // 诊断: 记录完整 turn_end 详情(含 errorMessage,用于定位 stopReason=error)。走 logger debug 级别
        try {
          const contentSummary = Array.isArray(msg?.content)
            ? msg.content.map((c) => ({ type: c.type, textPreview: c.text?.slice(0, 200) }))
            : 'no content array'
          log(
            'debug',
            'agent',
            `TURN_END: stopReason=${msg?.stopReason ?? '?'} tools=${tcInTurn} outputLen=${outputText.length} errorMessage=${msg?.errorMessage ?? 'none'} content=${JSON.stringify(contentSummary)}`,
          )
        } catch {
          // ignore
        }
        break
      }
      case 'agent_end': {
        const messages = event.messages
        for (const msg of messages) {
          if (msg && msg.role === 'assistant' && 'usage' in msg) {
            const u = (
              msg as { usage?: { input?: number; output?: number; cost?: { total?: number } } }
            ).usage
            if (u) {
              inputTokens += u.input ?? 0
              outputTokens += u.output ?? 0
              if (u.cost) {
                totalCost += u.cost.total ?? 0
              }
            }
          }
        }
        break
      }
    }
  })

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
    await withTimeout(agent.waitForIdle(), WAIT_FOR_IDLE_TIMEOUT_MS, `Agent waitForIdle(${id})`)
    console.log(
      `[AgentService] runAgent(${id}) first pass: turns=${turnCount} outputLen=${outputText.length} toolCalls=${toolCallCount}`,
    )
    log(
      'debug',
      'agent',
      `runAgent(${id}) first pass done: turns=${turnCount} outputLen=${outputText.length} toolCalls=${toolCallCount}`,
    )

    // ── 智能续跑循环 ──
    // 当模型过早结束（输出短 AND 轮次少）时，发送续跑提示让模型继续完成任务
    // 优化: 当 LLM 返回 429(rate_limit) / 401(auth) / 403(forbidden) 等不可重试错误时,跳过续跑
    // 避免对已限流/鉴权失败的账户继续发起无意义的 API 调用
    // 修复: isNonRetryableError 为函数,每次循环重新检查 lastErrorMessage(可能在续跑中变化)
    const isNonRetryableError = (errMsg: string): boolean => {
      if (!errMsg) return false
      const lower = errMsg.toLowerCase()
      return (
        lower.includes('429') ||
        lower.includes('401') ||
        lower.includes('403') ||
        lower.includes('rate_limit') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests') ||
        lower.includes('quota') ||
        lower.includes('unauthorized') ||
        lower.includes('forbidden') ||
        lower.includes('authentication failed') ||
        lower.includes('invalid api key')
      )
    }
    let continuationCount = 0
    while (
      !isNonRetryableError(lastErrorMessage) &&
      continuationCount < MAX_CONTINUATIONS &&
      outputText.length < MIN_OUTPUT_CHARS &&
      turnCount < MIN_TURN_COUNT &&
      !abortController.signal.aborted
    ) {
      continuationCount++
      const prevOutputLen = outputText.length
      const remainingTasks = Math.max(0, MIN_TURN_COUNT - turnCount)
      const contPrompt =
        `[系统指令] 你的回复过早结束。你只完成了 ${turnCount} 轮操作，输出了 ${outputText.length} 个字符。` +
        `用户的任务需要更多步骤才能完成。请继续使用可用工具完成任务，至少还需执行 ${remainingTasks} 轮操作。` +
        `不要只说一句概述就停止，要积极调用工具执行实际操作。`
      console.log(
        `[AgentService] runAgent(${id}) continuation #${continuationCount}: turns=${turnCount} outputLen=${outputText.length}`,
      )
      // 修复: 不再重置 turnCount 为 0,保留累积轮次以正确判断续跑条件
      const prevTurnCount = turnCount
      await agent.prompt(contPrompt)
      await withTimeout(
        agent.waitForIdle(),
        WAIT_FOR_IDLE_TIMEOUT_MS,
        `Agent waitForIdle(${id}) cont#${continuationCount}`,
      )
      // 修复: 续跑后如果出现不可重试错误,立即退出(避免继续浪费 API 调用)
      if (isNonRetryableError(lastErrorMessage)) {
        console.log(
          `[AgentService] runAgent(${id}) continuation #${continuationCount} hit non-retryable error: ${lastErrorMessage.slice(0, 100)}`,
        )
        break
      }
      // 如果本轮输出没有增长且轮次没有增加,说明模型已无法继续,提前退出避免浪费 API 调用
      if (outputText.length <= prevOutputLen && turnCount <= prevTurnCount) {
        console.log(
          `[AgentService] runAgent(${id}) continuation #${continuationCount} no progress (outputLen: ${prevOutputLen}→${outputText.length}, turns: ${prevTurnCount}→${turnCount}), stopping early`,
        )
        break
      }
      console.log(
        `[AgentService] runAgent(${id}) cont#${continuationCount} done: turns=${turnCount} outputLen=${outputText.length}`,
      )
    }
    if (continuationCount > 0) {
      console.log(
        `[AgentService] runAgent(${id}) total continuations: ${continuationCount}, final outputLen=${outputText.length}`,
      )
    }
    console.log(`[AgentService] runAgent(${id}) idle, output length=${outputText.length}`)

    // 优化: 当输出为空且 LLM 返回了错误时,标记为 error 而非 success
    // 此前 stopReason=error 的空输出被标记为 success,用户看不到任何错误提示
    const hasError = outputText.length === 0 && !!lastErrorMessage
    const finalStatus: AgentExecution['status'] = hasError ? 'error' : 'success'
    const finalOutput = outputText || (hasError ? `[LLM 错误] ${lastErrorMessage}` : '')

    // 记录执行历史
    const execution: AgentExecution = {
      id: `exec_${Date.now()}`,
      agentId: id,
      prompt,
      output: finalOutput,
      startedAt,
      durationMs: Date.now() - startedAt,
      tokenUsage: {
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      cost: totalCost,
      status: finalStatus,
    }
    deps.appendExecution(id, execution)

    // 同步写入 DB
    if (dbExecId >= 0) {
      dbService.updateExecution(dbExecId, {
        status: hasError ? 'failure' : 'success',
        output: finalOutput,
        error: hasError ? lastErrorMessage : undefined,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        costTotal: totalCost,
      })
    }

    // 更新状态
    if (hasError) {
      deps.setStatus(id, 'error')
      sendAgentStatus(win, id, 'error', { error: lastErrorMessage, result: execution })
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
    // R170 修复: error 时 output 必须保留 errorMsg,即使已有部分输出。
    // 此前 outputText || errorMsg 在"部分输出 + 中途 429/quota"场景丢失错误关键词,
    // cron 熔断器 isQuotaError 匹配不到 output,配额耗尽后 cron 继续空转。
    const catchOutput = outputText ? `${outputText}\n[error] ${errorMsg}` : errorMsg
    const execution: AgentExecution = {
      id: `exec_${Date.now()}`,
      agentId: id,
      prompt,
      output: catchOutput,
      startedAt,
      durationMs: Date.now() - startedAt,
      tokenUsage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: totalCost,
      status: isAborted ? 'timeout' : 'error',
    }
    deps.appendExecution(id, execution)

    // 同步写入 DB
    if (dbExecId >= 0) {
      dbService.updateExecution(dbExecId, {
        status: isAborted ? 'aborted' : 'failure',
        output: catchOutput,
        error: errorMsg,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        costTotal: totalCost,
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
