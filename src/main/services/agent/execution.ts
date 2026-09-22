// =============================================================
// Agent 单次执行流程 — 编排骨干
// （从 AgentService.executeRun 抽出；M16 进一步拆分纯逻辑:
//   agent/system-prompt.ts   系统提示词拼接(纯函数)
//   agent/event-collector.ts 事件订阅 → 输出/token/turn 聚合器
//   agent/continuation.ts    isNonRetryableError + 智能续跑循环
// 本文件保留: 选模型 → 建实例 → 接线 → 落库 → 清理 的编排链路;
// 日志前缀与事件负载逐字保留,行为零变化)
// =============================================================

import { Agent } from '@earendil-works/pi-agent-core'
import type {
  AgentMessage,
  AgentTool,
  CompactionSettings,
  ThinkingLevel,
} from '@main/services/llm-contracts'
import type { AgentConfig, AgentExecution, AgentRunSource, AgentStatus } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { resolveApiKey, selectModel } from '../agent-model-selector'
import {
  compactAgentMessages,
  computeAdaptiveReserve,
  estimateMessageTokens,
} from '../compaction-helper'
import { dbService } from '../db-service'
import { createDshAgent } from '../dsh/agent-facade'
import { dshRouteFor } from '../dsh/route'
import { createDshRuntime, type DshRuntime, getDshRuntimeCwd } from '../dsh/runtime'
import {
  type EaaToolMount,
  ensureActiveEaaToolBridge,
  mountEaaAgentTools,
} from '../dsh/tool-bridge'
import { ollamaService } from '../ollama-service'
import { createAssistantPlaceholder } from '../pi-ai-helpers'
import { settingsService } from '../settings-service'
import { getClassContextSection } from './class-context'
import { runContinuationLoop } from './continuation'
import { createEventCollector } from './event-collector'
import { memoryService } from './memory-service'
import { assertPrivacyReadyForRun, isAutoAnonymizeEnabled, PrivacyGuard } from './privacy-guard'
import { createRetryingStreamFn } from './retrying-stream'
import { clearActiveRunSource, sendAgentStatus, setActiveRunSource } from './status-tracking'
import { buildSystemPrompt } from './system-prompt'
import { withTimeout } from './timeout'
import type { AgentExecutionDeps, AgentRuntimeLike } from './types'

/** 成功/失败两条路径共用的执行记录头部(公共字段单一来源) */
function buildExecutionBase(
  agentId: string,
  prompt: string,
  output: string,
  startedAt: number,
  stats: { inputTokens: number; outputTokens: number; totalCost: number },
): AgentExecution {
  return {
    id: `exec_${Date.now()}`,
    agentId,
    prompt,
    output,
    startedAt,
    durationMs: Date.now() - startedAt,
    tokenUsage: {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    cost: stats.totalCost,
    status: 'success',
  }
}

/** 内部已推送过 error 状态的错误(外层守卫据此去重,避免渲染进程收到两条错误) */
function markedError(msg: string): Error {
  const err = new Error(msg)
  ;(err as { reportedToRenderer?: boolean }).reportedToRenderer = true
  return err
}

/**
 * runAgent 入口(排队前)与出队后共用的可运行性守卫 — 排队期间配置可能被
 * 删除/停用,两处判定必须一致。抛 markedError:入口路径的调用方(IPC/委托
 * 工具)只消费 message;出队路径经外层守卫去重,不会二次推送渲染进程。
 */
function assertAgentRunnable(
  config: AgentConfig | undefined,
  id: string,
  win: BrowserWindow | undefined,
  setStatus: (id: string, status: AgentStatus) => void,
): asserts config is AgentConfig {
  if (!config) {
    const msg = `Agent not found: ${id}`
    sendAgentStatus(win, id, 'error', { error: msg })
    throw markedError(msg)
  }
  if (!config.enabled) {
    // P1-3: disabled 时先推送状态再抛错，渲染进程能看到
    const msg = `Agent is disabled: ${id}`
    setStatus(id, 'error')
    sendAgentStatus(win, id, 'error', { error: msg })
    throw markedError(msg)
  }
}

/** abort 序列共用: controller.abort + agent.abort() 吞错(agent 已停止时会抛,无害) */
async function abortAgentInstance(
  agent: { abort: () => unknown },
  abortController: AbortController,
  id: string,
): Promise<void> {
  abortController.abort()
  try {
    await Promise.resolve(agent.abort())
  } catch (err) {
    console.warn(`[Agent] abort() threw for ${id}:`, errText(err))
  }
}

/** setStatus + sendAgentStatus 成对推送 — 漏发其一曾是状态面/事件面分叉的根源 */
function notifyStatus(
  deps: AgentExecutionDeps,
  win: BrowserWindow | undefined,
  id: string,
  status: AgentStatus,
  extras: Record<string, unknown> = {},
): void {
  deps.setStatus(id, status)
  sendAgentStatus(win, id, status, extras)
}

/**
 * 实际执行一次 Agent 运行(由 runAgent 队列串行调用),返回执行记录(含真实 status)
 *
 * 外层守卫: 内部任何阶段抛错(选模型无 key/隐私断言/MCP 启动失败等)都必须
 * 推送 error 状态事件到渲染进程 — 否则 fire-and-forget 的 IPC 调用方只
 * console.error,用户界面永远静止(2026-08-28 审计的致命项)。
 * 内部已自行推送过的错误带 reportedToRenderer 标记,此处去重。
 */
export async function executeAgentRun(
  deps: AgentExecutionDeps,
  id: string,
  prompt: string,
  win: BrowserWindow | undefined,
  history?: Array<{ role: string; content: string; timestamp?: number }>,
  generation?: number,
  source: AgentRunSource = 'ui',
): Promise<AgentExecution | undefined> {
  try {
    return await executeAgentRunInner(deps, id, prompt, win, history, generation, source)
  } catch (err) {
    const reported = (err as { reportedToRenderer?: boolean }).reportedToRenderer === true
    if (!reported) {
      const raw = errText(err)
      console.error(`[AgentService] runAgent(${id}) failed before stream:`, raw)
      notifyStatus(deps, win, id, 'error', { error: raw })
    }
    throw err
  }
}

async function executeAgentRunInner(
  deps: AgentExecutionDeps,
  id: string,
  prompt: string,
  win: BrowserWindow | undefined,
  history?: Array<{ role: string; content: string; timestamp?: number }>,
  generation?: number,
  source: AgentRunSource = 'ui',
): Promise<AgentExecution | undefined> {
  // 排队期间可能被删除/停用 → 与 runAgent 入口共用同一守卫
  const config = deps.getConfig(id)
  assertAgentRunnable(config, id, win, deps.setStatus)

  // M0: 登记本次运行来源 — 本函数内所有 sendAgentStatus(含事件收集器)
  // 经 status-tracking 登记表自动盖上 source;finally 清除。
  setActiveRunSource(id, source)

  // ── 隐私自动脱敏(fail-closed) ──
  // 开启 privacy.enabled + autoAnonymize 但隐私引擎未解锁 → 直接失败,
  // 不静默发送含真实姓名的内容给模型(违背用户明确表达的脱敏意图)。
  assertPrivacyReadyForRun()
  let privacyGuard: PrivacyGuard | undefined
  if (isAutoAnonymizeEnabled()) {
    try {
      privacyGuard = await PrivacyGuard.create()
      console.log(
        `[AgentService] runAgent(${id}) privacy guard active (${privacyGuard.mappingCount} mappings)`,
      )
    } catch (err) {
      const msg = errText(err)
      notifyStatus(deps, win, id, 'error', { error: `隐私脱敏初始化失败: ${msg}` })
      throw markedError(`隐私脱敏初始化失败: ${msg}`)
    }
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
  // privacyGuard 非空时 EAA 工具会被包装(入参化名→真名,结果真名→化名)
  // P2-8: 视觉模型注入 read_image(聊天视觉通道)
  // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  const tools: AgentTool<any>[] = await deps.buildAgentTools(
    config,
    id,
    win,
    privacyGuard,
    Array.isArray(model.input) && model.input.includes('image'),
  )

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
  const followUpMode = chatSettings?.followUpMode ?? 'one-at-a-time'
  const showImages = chatSettings?.showImages ?? true
  const compactionEnabled = chatSettings?.compaction?.enabled ?? true
  const compactionReserve = chatSettings?.compaction?.reserveTokens ?? 8000
  const compactionKeep = chatSettings?.compaction?.keepRecentTokens ?? 16000
  console.log(
    `[AgentService] runAgent(${id}) chat config: steering=${steeringMode} followUp=${followUpMode} showImages=${showImages} compaction=${compactionEnabled ? 'on' : 'off'} reserve=${compactionReserve} keepRecent=${compactionKeep}`,
  )

  // 构造 system prompt (含 SOUL + 项目背景 + 当前班级 + 公共规则 + 角色 Rules + Skills
  //  + 长期记忆 + 风险阈值 + 转向/后续/图片设置)
  // 注意:此处先拼好,后面会被 systemPrompt setter 覆盖
  // M10: 公共规则(agents/_shared/rules.md)单点注入,角色 AGENTS.md 只保留角色差异段
  // M16: 模板拼接拆到 agent/system-prompt.ts(纯函数)
  // R2-05: 注入「当前班级」元数据 — AI 开场即知名称/年级/人数/科目
  const classContextSection = await getClassContextSection()
  const systemPrompt = buildSystemPrompt({
    config: { name: config.name, role: config.role, description: config.description },
    soulContent: deps.getSoulContent(id),
    projectContextContent: deps.getProjectContextContent(),
    classContextSection,
    sharedRulesContent: deps.getSharedRulesContent(),
    rulesContent: deps.getRulesContent(id),
    skillsSection: deps.buildSkillsSection(config.capabilities),
    // R2-08: 记忆注入过脱敏管线 — 记忆落盘为真名(见 memory-tool),
    // 当次运行开启自动脱敏时,出域前把真名转回化名(与 chat 历史同待遇)
    memorySection: privacyGuard
      ? privacyGuard.anonymize(memoryService.getMemorySection(id))
      : memoryService.getMemorySection(id),
    riskThresholds: config.riskThresholds,
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
    // R136 优化: 廉价预检查 — 估算 token < 阈值 * 0.8 时跳过完整扫描
    // 避免每轮都对全部消息做 O(N) token 估算(常见于会话初期)
    // (M16: 统计规则收敛到 compaction-helper.estimateMessageTokens,此处是第三个消费方;
    //   2026-08-28 智能轮: /4 字符估算改为 CJK 感知,与完整评估同口径,
    //   否则中文会话预检查放行、完整评估又触发,预检查失效)
    const threshold = model.contextWindow - compactionSettings.reserveTokens
    let quickTokens = 0
    for (let i = 0; i < messages.length; i++) {
      quickTokens += estimateMessageTokens(messages[i])
      // 提前退出: 已超阈值 * 0.8 就停止统计, 进入完整评估
      if (quickTokens > threshold * 0.8) break
    }
    if (quickTokens < threshold * 0.8) {
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
        // R2+: 压缩对用户可见(此前只有 console.log,表现为 AI 突然失忆)
        sendAgentStatus(win, id, 'running', { compacted: true })
      }
      return result
    } catch (err) {
      console.warn('[AgentService] compaction failed (non-fatal):', err)
      return messages
    }
  }

  // 后端切换：dsh 走子进程替身，缺省 pi。每个执行独占一个 DshRuntime —
  // SDK 无按轮取消，abort 只能整体关停子进程，共用会误杀其它并发会话。
  let useDsh = false
  try {
    useDsh = settingsService.getSettings().models?.agentRuntime !== 'pi'
  } catch (err) {
    // 设置读不到时按现网后端跑，不能让一次读失败打断智能体执行
    console.warn(`[Agent] settings unreadable, using pi runtime for ${id}: ${errText(err)}`)
  }
  // 工具面按本次运行挂载：dsh 子进程只看得见这一个端点，也就是这个角色的工具集
  // （capability 裁剪、delegate_to 只给 main、脱敏包装都已在 tools 里定型）。
  // harness 自带工具由 createDshRuntime 附的那份 patch 关掉。
  // release 在 finally：端点和含 token 的 patch 文件都不跨运行残留。
  let toolMount: EaaToolMount | null = null
  let dshRuntime: DshRuntime | null = null
  if (useDsh) {
    await ensureActiveEaaToolBridge({ patchDir: getDshRuntimeCwd() })
    toolMount = await mountEaaAgentTools({ label: id, tools })
    // 路由名按 settings.models.dshRoutes 映射（dsh 的 provider 路由是用户在自己
    // dsh 配置里声明的 key，不等于 pi 的 provider id）
    const route = dshRouteFor(String(model.provider), model.id)
    dshRuntime = createDshRuntime({
      provider: route.providerId,
      model: route.modelId,
      patches: [toolMount.patchPath],
    })
    log(
      'info',
      'agent',
      `runAgent(${id}) dsh 工具挂载 serverName=${toolMount.serverName} tools=${tools.length}`,
    )
  }

  let agent: AgentRuntimeLike
  if (dshRuntime && toolMount) {
    agent = createDshAgent({
      runtime: dshRuntime,
      model,
      systemPrompt,
      // dsh 侧工具被强制改写成 mcp__<serverName>__<name>，提示词里的裸名必须同步
      toolNameMap: toolMount.toolNameMap,
    })
  } else {
    agent = new Agent({
      // pi-agent-core 0.85: streamFn 必填,显式传入 pi-ai 的流式实现
      // R2+: 经 createRetryingStreamFn 包装 — 建流阶段(429/超时/网络)按
      // models.retry.* 指数退避重试,与直连聊天路径同策略(此前 agent 链路零重试)
      streamFn: createRetryingStreamFn(),
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
  }

  // 设置工具
  agent.state.tools = tools
  const startedAt = Date.now()

  // M15: waitForIdle 的超时包装(null = 不限,直接等待,避免 setTimeout(Infinity) 立即触发)
  const waitIdle = (label: string): Promise<void> =>
    idleTimeoutMs === null
      ? agent.waitForIdle()
      : withTimeout(agent.waitForIdle(), idleTimeoutMs, label)

  // 记录运行时实例(M0: 含 source,abortAgent 据此做来源隔离)
  deps.setRunning(id, { agent, abortController, agentId: id, startedAt, source })

  // M16: 事件收集器(输出/token/turn 聚合 + 渲染进程状态转发,实现拆到 event-collector.ts)
  const collector = createEventCollector(win, id)
  const { stats } = collector

  // 同步写入 DB(成功/失败两路径共用;dbExecId<0 = recordExecutionStart 未执行/失败)
  const persistToDb = (
    status: 'success' | 'failure' | 'aborted',
    output: string,
    error: string | undefined,
  ): void => {
    if (dbExecId >= 0) {
      dbService.updateExecution(dbExecId, {
        status,
        output,
        error,
        tokensInput: stats.inputTokens,
        tokensOutput: stats.outputTokens,
        costTotal: stats.totalCost,
      })
    }
  }

  // 脱敏开启时,流式增量先经 carry 过滤器安全还原(尾部疑似化名前缀的字符
  // 扣到下一段再判定,避免 "S_001" 被切成两半漏替换),再进入收集器 —
  // stats.outputText 与推送给渲染进程的内容因此都已是真名。
  const streamDeanon = privacyGuard?.createStreamDeanonymizer()
  const collectorHandler = (event: Parameters<typeof collector.handler>[0]) => {
    if (
      streamDeanon &&
      event.type === 'message_update' &&
      event.assistantMessageEvent &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      const restored = streamDeanon.push(event.assistantMessageEvent.delta)
      collector.handler({
        ...event,
        assistantMessageEvent: { ...event.assistantMessageEvent, delta: restored },
      })
      return
    }
    collector.handler(event)
  }

  // M-4 修复: 声明 dbExecId 在 try 外(供 catch 使用),赋值移入 try 内
  // 之前 recordExecutionStart 在 try-catch 外,若 DB 抛错会导致 agent 状态卡死、unsubscribe 泄漏
  let dbExecId = -1

  const unsubscribe = agent.subscribe(collectorHandler)

  // ── 注入对话历史（让 Agent 拥有完整上下文）──
  // pi-agent-core 的 runAgentLoop 会将 state.messages + 新 prompt 合并后发给 LLM
  // 因此这里把前端传来的聊天历史转为 AgentMessage[] 并注入 state.messages
  // 脱敏开启时历史内容先真名→化名(历史含真实姓名,不能原样发给模型)
  if (history && history.length > 0) {
    const historyMessages: AgentMessage[] = []
    for (const msg of history) {
      if (!msg.content) continue
      const content = privacyGuard ? privacyGuard.anonymize(msg.content) : msg.content
      // 时间戳透传: 全部重置为 now 会让模型无法区分"上周说的"和"刚才说的"
      // (渲染端旧历史无时间戳时回退 now,保持兼容)
      const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()
      if (msg.role === 'user') {
        historyMessages.push({
          role: 'user' as const,
          content,
          timestamp,
        })
      } else if (msg.role === 'assistant') {
        // 最小合法 AssistantMessage 占位(构造统一收口 pi-ai-helpers)
        historyMessages.push(createAssistantPlaceholder(content, model, timestamp) as AgentMessage)
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
    notifyStatus(deps, win, id, 'running')
    // ── 执行 Agent（含智能续跑）──
    console.log(`[AgentService] runAgent(${id}) calling agent.prompt()...`)
    // 诊断(走 logger debug): 记录 prompt 调用前的 model/apiKey/tools 状态
    log(
      'debug',
      'agent',
      `runAgent(${id}) calling agent.prompt(), model=${model.provider}/${model.id}, apiKey=${apiKeyResolved ? 'present' : 'MISSING'}, tools=${tools.length}`,
    )
    await agent.prompt(privacyGuard ? privacyGuard.anonymize(prompt) : prompt)
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
      // AgentRuntimeLike.prompt 返回 unknown（pi 返回 Promise、替身返回 void），
      // 续跑循环的契约要 Promise；await 对两者语义一致（入队即 resolve）
      prompt: async (text) => {
        await agent.prompt(text)
      },
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

    // 脱敏流式还原的收尾: 释放 carry 中扣住的尾部字符(镜像收集器的 text_delta 处理,
    // 保证 stats 与渲染进程拿到完整文本)
    if (streamDeanon) {
      const rest = streamDeanon.flush()
      if (rest) {
        stats.outputText += rest
        sendAgentStatus(win, id, 'running', { output: rest })
      }
    }

    // 攒批的输出 delta 必须在最终状态前刷出(否则最后 33ms 窗口内的文本丢失)
    collector.flushPendingOutput()

    // 优化: 当输出为空且 LLM 返回了错误时,标记为 error 而非 success
    // 此前 stopReason=error 的空输出被标记为 success,用户看不到任何错误提示
    // P1-5(09-13 深查 B3): 不再要求输出为空 — 半截输出+中途错误同样按 error
    // 收尾。此前该场景被记 success,截断回复伪装完整、错误信息对用户/DB 双丢。
    // (stale error 已由 event-collector 清除: 后续非 error 轮会清空 lastErrorMessage)
    const hasError = !!stats.lastErrorMessage
    // M0: 外部 abort 后 pi-agent-core 把 abort 变成正常 turn 结束,prompt() 照常
    // resolve 并走到这里 — 半截输出不得伪装 success(飞书会把半截话当完整回复
    // 发出,DB 还记 success)。检测 abortController 并改记 aborted。
    const wasAborted = abortController.signal.aborted
    let finalStatus: AgentExecution['status'] = hasError ? 'error' : 'success'
    if (wasAborted) finalStatus = 'aborted'
    // 中断标注: 有部分输出时附 [中断] 行 — 渲染层错误分支据此去重(不二次追加)
    const rawOutput = stats.outputText
      ? hasError
        ? `${stats.outputText}\n\n[中断] ${stats.lastErrorMessage}`
        : stats.outputText
      : hasError
        ? `[LLM 错误] ${stats.lastErrorMessage}`
        : ''
    // 兜底还原(流式过滤器已处理绝大多数;对非化名文本是 no-op)
    const finalOutput = privacyGuard ? privacyGuard.deanonymize(rawOutput) : rawOutput

    // 记录执行历史
    const execution: AgentExecution = {
      ...buildExecutionBase(id, prompt, finalOutput, startedAt, stats),
      status: finalStatus,
      // R2+: 实际执行模型回传(tier→default→ollama 降级链的最终选择)
      model: `${model.provider}/${model.id}`,
    }
    deps.appendExecution(id, execution)

    persistToDb(
      wasAborted ? 'aborted' : hasError ? 'failure' : 'success',
      finalOutput,
      hasError ? stats.lastErrorMessage : undefined,
    )

    // 更新状态
    if (wasAborted) {
      // P0-1: 中止原因随事件下发 — 渲染层据此提示"已停止/超时"而非纯沉默
      notifyStatus(deps, win, id, 'idle', {
        result: execution,
        aborted: true,
        abortReason: 'user',
      })
    } else if (hasError) {
      notifyStatus(deps, win, id, 'error', { error: stats.lastErrorMessage, result: execution })
    } else {
      notifyStatus(deps, win, id, 'idle', { result: execution })
    }
    return execution
  } catch (err: unknown) {
    // 异常路径同样先刷出缓冲,保证渲染端已收到的流式输出完整
    collector.flushPendingOutput()
    const errorMsg = errText(err)
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
      ...buildExecutionBase(id, prompt, catchOutput, startedAt, stats),
      status: isAborted || isTimeout ? 'timeout' : 'error',
    }
    deps.appendExecution(id, execution)

    // DB schema CHECK 不含 'timeout',沿用既有映射: 内存 'timeout' → DB 'aborted'
    persistToDb(isAborted || isTimeout ? 'aborted' : 'failure', catchOutput, errorMsg)

    // High 5.4 修复: abortAgent 与 runAgent finally 双重状态转移
    // 之前无论是 abort 还是真实 error 都设 'error' 状态,
    // 但 abortAgent 之后又会设 'idle',导致状态从 error 翻转为 idle,前端收到矛盾事件
    // 修复: 如果是 abort 导致的,不设 error 状态(让 abortAgent 统一设 idle);
    // 只在真实 error 时设 error 状态
    if (!isAborted) {
      notifyStatus(deps, win, id, 'error', { error: errorMsg })
    }
    // abort 路径: 不在此处发状态事件,由 abortAgent 统一发送 idle + aborted: true
    return execution
  } finally {
    // 修复: finally 块中 abort,确保 agent 异常退出(如 waitForIdle 超时)后
    // 不再继续消耗 API token。abort() 是幂等的,已被 abortAgent 调用过时再调是 no-op。
    // 必须在 catch 块处理完之后再 abort(catch 中检查 isAborted 区分 abort 和真实 error)。
    if (!abortController.signal.aborted) {
      await abortAgentInstance(agent, abortController, id)
    }
    unsubscribe()
    deps.deleteRunning(id)
    // dsh 路径: 撤掉本次运行的 MCP 端点与 patch 文件(子进程已在上面 abort 时关掉)
    if (toolMount) await toolMount.release()
    // M0: 清除来源登记(放在 deleteRunning 旁,与 setRunning 对称)
    clearActiveRunSource(id)
  }
}
