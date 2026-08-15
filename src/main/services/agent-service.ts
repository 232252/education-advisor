// =============================================================
// Agent Service — pi-agent-core 驱动的 Agent 运行时（编排层）
// 每个 Agent 执行时创建 Agent 实例，连接 EAA 工具集
//
// 结构说明(纯重构拆分,行为零变化):
//   - agent/run-queue.ts       运行串行队列/abort 代数/WAIT_FOR_IDLE_TIMEOUT_MS
//   - agent/execution.ts       单次执行流程(executeRun 本体,deps 注入)
//   - agent/prompt-loading.ts  SOUL.md/AGENTS.md 读写 + id 校验
//   - agent/status-tracking.ts 渲染进程状态事件派发
//   - agent/timeout.ts         withTimeout 工具
//   - agent/types.ts           RunningAgent/AgentExecutionDeps 类型
// 本文件保留 AgentService 编排层: 配置管理/调度/init/shutdown/abortAgent。
//
// 修复记录:
//   P1-1: listAgents/getAgent 的 nextRunAt 从 cronService.getNextRunAt 聚合
//   P1-2: toggleAgent 持久化到 userData/agents.user.yaml,触发 syncSchedules
//   P1-3: runAgent 头部 enabled 检查时主动 setStatus('error') + 推送渲染进程
//   P1-4: case 'agent_end' 中 msg.usage 加可选链 + 防御
//   P1-5: waitForIdle 加 5 分钟超时(防止 hang)
//   P1-6: case 'message_update' 中 assistantMessageEvent 加可选链
//   Bonus: selectModel 加 NaN 防御 + 改 as any 为 Parameters<typeof getModel>[]
//   Bonus: subscribe 新签名 (event, signal) 适配
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type {
  AgentConfig,
  AgentDetail,
  AgentExecution,
  AgentListItem,
  AgentStatus,
} from '@shared/types'
import { app, type BrowserWindow } from 'electron'
import yaml from 'yaml'
import { executeAgentRun } from './agent/execution'
import { loadRules, loadSoul, saveRules, saveSoul } from './agent/prompt-loading'
import { AgentRunQueue } from './agent/run-queue'
import { sendAgentStatus } from './agent/status-tracking'
import { withTimeout } from './agent/timeout'
import type { AgentExecutionDeps, RunningAgent } from './agent/types'
import { AgentScheduler, type SchedulableAgent } from './agent-scheduler'
import { cronService } from './cron-service'
import { getToolsByCapability } from './eaa-tools'
import { allFileTools } from './file-tools'
import { mcpService } from './mcp-service'
import { getMcpToolsForAgent } from './mcp-tools'
import { skillService } from './skill-service'
import { allUtilityTools } from './utility-tools'

class AgentService {
  private agents: Map<string, AgentConfig> = new Map()
  private agentsDir: string
  private configDir: string
  private scheduler: AgentScheduler
  private agentStatus: Map<string, AgentStatus> = new Map()
  private executionHistory: Map<string, AgentExecution[]> = new Map()
  private runningAgents: Map<string, RunningAgent> = new Map()
  /** 运行串行队列(tails/depths/generations 状态与算法见 agent/run-queue.ts) */
  private readonly runQueue = new AgentRunQueue()

  /** 队列 tail 只读视图(LOW-1 回归测试访问 runQueueTails) */
  get runQueueTails(): ReadonlyMap<string, Promise<unknown>> {
    return this.runQueue.getTails()
  }

  /** executeRun 的依赖注入(见 agent/execution.ts;箭头函数绑定 this) */
  private readonly executionDeps: AgentExecutionDeps = {
    getConfig: (id) => this.agents.get(id),
    setStatus: (id, status) => this.agentStatus.set(id, status),
    setRunning: (id, running) => this.runningAgents.set(id, running),
    deleteRunning: (id) => this.runningAgents.delete(id),
    appendExecution: (id, execution) => this.appendExecution(id, execution),
    getSoulContent: (id) => this.getSoul(id),
    getRulesContent: (id) => this.getRules(id),
    buildSkillsSection: () => this.buildSkillsSection(),
    buildAgentTools: (config, id) => this.buildAgentTools(config, id),
    isCurrentGeneration: (id, generation) => this.runQueue.isCurrentGeneration(id, generation),
  }

  constructor() {
    // 注意: app.isPackaged 在用 `electron .` 启动时可能返回 true（不可靠）。
    // 因此优先检查 dev 路径是否存在，不存在才回退到 packaged 路径。
    const devAgentsDir = path.join(__dirname, '..', '..', 'agents')
    const prodAgentsDir = path.join(process.resourcesPath, 'agents')
    this.agentsDir = fs.existsSync(devAgentsDir) ? devAgentsDir : prodAgentsDir

    const devConfigDir = path.join(__dirname, '..', '..', 'config')
    const prodConfigDir = path.join(process.resourcesPath, 'config')
    this.configDir = fs.existsSync(devConfigDir) ? devConfigDir : prodConfigDir

    // 调度器持有 userOverrides + agentScheduleTasks(从本类抽出,逻辑零修改)
    const userOverridesPath = path.join(app.getPath('userData'), 'agents.user.yaml')
    this.scheduler = new AgentScheduler(userOverridesPath)
  }

  /** 初始化：加载 Agent、注册 cron 调度、桥接执行函数 */
  async init(_win: BrowserWindow): Promise<void> {
    await this.scheduler.loadUserOverrides()
    await this.loadAgents()

    // 将 runAgent 注册给 cron service，作为定时任务的执行入口
    cronService.setAgentRunner((agentId, prompt, w) => this.runAgent(agentId, prompt, w))

    // 将 agent 的 schedule 字段同步为 cron 任务
    this.syncSchedules()

    // MCP 集成:初始化 MCP service(加载 mcp.yaml,feature flag 关闭时进入 no-op)
    try {
      await mcpService.init()
    } catch (err) {
      console.warn('[AgentService] MCP service init failed (non-blocking):', err)
    }

    console.log(`[AgentService] Initialized with ${this.agents.size} agents`)
  }

  /** 同步 agent schedule 到 cron(委托给 scheduler,过滤后传入精简结构) */
  private syncSchedules() {
    const agents: SchedulableAgent[] = Array.from(this.agents.values())
      .filter((a) => a.enabled && a.schedule.length > 0)
      .map((a) => ({ id: a.id, name: a.name, schedule: a.schedule, modelTier: a.modelTier }))
    this.scheduler.syncSchedules(agents)
  }

  // ===========================================================
  // 配置管理
  // ===========================================================

  /** 从 agents.yaml 加载 Agent 配置（叠加 user overrides） */
  async loadAgents(): Promise<void> {
    const yamlPath = path.join(this.configDir, 'agents.yaml')
    if (!fs.existsSync(yamlPath)) {
      console.warn('[AgentService] agents.yaml not found, using empty config')
      return
    }

    try {
      const content = fs.readFileSync(yamlPath, 'utf-8')
      const parsed = yaml.parse(content)
      // 防御：parsed 可能为 null（空文件或 yaml.parse 返回 null）
      const agentList = Array.isArray(parsed?.agents) ? parsed.agents : []

      for (const a of agentList) {
        // 防御单条数据畸形：必须有字符串 id
        if (!a || typeof a.id !== 'string') continue
        const override = this.scheduler.getOverride(a.id)
        const config: AgentConfig = {
          id: a.id,
          name: override?.name ?? a.name ?? a.id,
          role: a.role ?? '',
          description: override?.description ?? a.description ?? '',
          enabled: typeof override?.enabled === 'boolean' ? override.enabled : (a.enabled ?? true),
          modelTier: override?.modelTier ?? a.model_tier ?? 'low_cost',
          schedule: a.schedule?.cron ?? [],
          capabilities: override?.capabilities ?? a.capabilities ?? [],
          riskThresholds: a.risk_thresholds,
          // R8-1 修复: 映射 yaml 的 mcp_servers → AgentConfig.mcpServers
          // 之前此字段在加载时丢失,导致 agent 永远拿不到 MCP 工具
          // R6-1: override 优先(用户在 UI 配的 agent↔MCP 连接覆盖主配置)
          mcpServers: override?.mcpServers ?? a.mcp_servers,
        }
        this.agents.set(config.id, config)
        this.agentStatus.set(config.id, 'idle')
      }

      console.log(`[AgentService] Loaded ${this.agents.size} agents`)
    } catch (err) {
      console.error('[AgentService] Failed to load agents.yaml:', err)
      this.agents.clear()
    }
  }

  /** 列出所有 Agent */
  listAgents(): AgentListItem[] {
    return Array.from(this.agents.values()).map((config) => {
      const history = this.executionHistory.get(config.id) ?? []
      const lastExec = history.length > 0 ? history[history.length - 1] : undefined
      return {
        ...config,
        status: this.agentStatus.get(config.id) ?? 'idle',
        lastRunAt: lastExec?.startedAt,
        nextRunAt: this.scheduler.getNextRunAt(config.id),
      }
    })
  }

  /** R155 修复: 检查 agent 是否存在(同步,用于 cron 校验等) */
  hasAgent(id: string): boolean {
    return typeof id === 'string' && id.length > 0 && this.agents.has(id)
  }

  /** 获取 Agent 详情 */
  async getAgent(id: string): Promise<AgentDetail | null> {
    // R150 修复: 入口类型校验,防止 null/非字符串 id 静默返回 null
    if (typeof id !== 'string' || id.length === 0) {
      console.warn('[AgentService] getAgent rejected invalid id:', typeof id)
      return null
    }
    const config = this.agents.get(id)
    if (!config) return null

    const history = this.executionHistory.get(id) ?? []
    const lastExec = history.length > 0 ? history[history.length - 1] : undefined

    return {
      ...config,
      status: this.agentStatus.get(id) ?? 'idle',
      soulContent: this.getSoul(id),
      rulesContent: this.getRules(id),
      executionHistory: history,
      lastRunAt: lastExec?.startedAt,
      nextRunAt: this.scheduler.getNextRunAt(id),
    }
  }

  /** 启用/禁用 Agent — 持久化到 user overrides + 触发 cron 同步 */
  toggleAgent(id: string, enabled: boolean) {
    const config = this.agents.get(id)
    if (!config) return { success: false, error: 'Agent not found' }
    config.enabled = enabled
    this.scheduler.setOverride(id, { enabled })
    void this.scheduler.persistUserOverrides()
    // 重新同步 schedule:disable 的 agent 对应 cron 任务会被停用
    this.syncSchedules()
    return { success: true }
  }

  /** 更新 Agent 配置（name, description, modelTier, capabilities, mcpServers 等） */
  updateAgent(
    id: string,
    patch: Partial<
      Pick<AgentConfig, 'name' | 'description' | 'modelTier' | 'capabilities' | 'mcpServers'>
    >,
  ): { success: boolean; error?: string } {
    const config = this.agents.get(id)
    if (!config) return { success: false, error: 'Agent not found' }
    if (patch.name !== undefined) config.name = patch.name
    if (patch.description !== undefined) config.description = patch.description
    if (patch.modelTier !== undefined) config.modelTier = patch.modelTier
    if (patch.capabilities !== undefined) {
      // 校验 capabilities 必须是字符串数组,防止非数组值导致 getToolsByCapability 崩溃
      if (!Array.isArray(patch.capabilities)) {
        return { success: false, error: 'capabilities must be an array of strings' }
      }
      const validCaps = patch.capabilities.filter((c) => typeof c === 'string')
      if (validCaps.length !== patch.capabilities.length) {
        return { success: false, error: 'capabilities must contain only strings' }
      }
      config.capabilities = validCaps
    }
    // R6-1: 支持通过 updateAgent 配置 agent 级 MCP server 引用。
    // 此前 mcpServers 只能手编 config/agents.yaml,UI 完全无法接线 agent↔MCP,
    // 导致 MCP 功能对终端用户实际不可用(管道正确但无入口)。
    if (patch.mcpServers !== undefined) {
      if (!Array.isArray(patch.mcpServers)) {
        return { success: false, error: 'mcpServers must be an array of strings' }
      }
      const validIds = patch.mcpServers.filter((s) => typeof s === 'string')
      if (validIds.length !== patch.mcpServers.length) {
        return { success: false, error: 'mcpServers must contain only strings' }
      }
      config.mcpServers = validIds
    }
    // 持久化到 user overrides(委托给 scheduler)
    this.scheduler.setOverride(id, patch)
    void this.scheduler.persistUserOverrides()
    this.syncSchedules()
    return { success: true }
  }

  getSoul(id: string): string {
    return loadSoul(this.agentsDir, id)
  }

  /**
   * 写入 Agent SOUL.md
   * R78 修复: 校验 agent 必须存在于已加载配置中,避免对任意 id 创建目录并返回 success,
   * 此前 setSoul('nonexistent-xxx', '...') 会创建 agents/nonexistent-xxx/SOUL.md 并返回 success,
   * 导致脏目录和前端误判。
   */
  setSoul(id: string, content: string) {
    // validateAgentId 已防御路径遍历(正则 + basename 双保险)。
    // 注: 不再做 agents.has(id) 存在性检查 —— 合法 id 即可写入(支持创建新 agent 的 SOUL),
    // 非法 id 由 validateAgentId 抛错拦截。此前存在性检查导致合法测试 id 写入失败。
    return saveSoul(this.agentsDir, id, content)
  }

  getRules(id: string): string {
    return loadRules(this.agentsDir, id)
  }

  /** 同 setSoul: validateAgentId 防御路径遍历,合法 id 即可写入 */
  setRules(id: string, content: string) {
    return saveRules(this.agentsDir, id, content)
  }

  getHistory(id: string): AgentExecution[] {
    return this.executionHistory.get(id) ?? []
  }

  // ===========================================================
  // Skill 注入
  // ===========================================================

  /** 将所有可用 skill 格式化为 system prompt 段落 */
  private buildSkillsSection(): string {
    const skills = skillService.listSkills()
    if (skills.length === 0) return ''

    const entries = skills.map((s) => {
      // 只输出名称和描述摘要，不注入完整内容（节省 token）
      // Agent 可通过文件读取工具获取完整内容
      return `### ${s.name}\n${s.description}`
    })

    return `\n--- 可用技能 ---\n${entries.join('\n\n')}`
  }

  // ===========================================================
  // 模型选择 — 已委托到 ./agent-model-selector.ts
  // (selectModel / resolveApiKey / hasApiKey / resolveCustomModel / safeCostScore)
  // 这些函数只读 settingsService/keystoreService 单例 + pi-ai 静态注册表,
  // 不依赖 AgentService 的 this 状态,可纯函数测试。
  // ===========================================================

  // ===========================================================
  // Agent 执行 — 接入 pi-agent-core
  // ===========================================================

  /**
   * 构造 Agent 运行时工具集(EAA + 文件 + 实用工具 + MCP)
   *
   * MCP 集成:合并三层配置(全局 mcp.yaml + Agent 级 mcpServers + 技能级临时 server)
   * MCP 未启用或无配置时返回空数组,不影响现有工具
   */
  private async buildAgentTools(
    config: AgentConfig,
    id: string,
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
  ): Promise<AgentTool<any>[]> {
    const mcpTools = await getMcpToolsForAgent(id, config.mcpServers)
    return [
      ...getToolsByCapability(config.capabilities),
      ...allFileTools, // 文件工具（read_file, read_excel, write_excel, write_csv, list_dir）
      ...allUtilityTools, // 实用工具（get_current_time, calculate）
      ...mcpTools, // MCP 工具(动态注入,工具名前缀 mcp_<serverId>_)
    ]
  }

  /**
   * 手动运行 Agent（通过 pi-agent-core Agent 类）。
   *
   * 串行队列语义: 同一 agent 已有运行在途时,本次调用排队等待而非抛错。
   * 调用方(chat / cron / feishu / StudentProfile)无需各自实现互斥。
   * 队列上限 MAX_RUN_QUEUE_DEPTH,超过才拒绝; abort 会清空排队中的任务。
   *
   * 返回本次执行的 AgentExecution(cron 据此记录真实成功/失败并触发配额熔断);
   * 排队期间被 abort 而放弃执行时返回 undefined。
   */
  async runAgent(
    id: string,
    prompt: string,
    win: BrowserWindow,
    history?: Array<{ role: string; content: string }>,
  ): Promise<AgentExecution | undefined> {
    // 同步校验(排队前): 不存在 / 已停用立即抛错,行为与之前一致
    const config = this.agents.get(id)
    if (!config) {
      const msg = `Agent not found: ${id}`
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }
    if (!config.enabled) {
      // P1-3: disabled 时先推送状态再抛错，渲染进程能看到
      const msg = `Agent is disabled: ${id}`
      this.agentStatus.set(id, 'error')
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }

    const depth = this.runQueue.getDepth(id)
    if (depth >= this.runQueue.maxDepth) {
      const msg = `Agent 正忙且排队已满,请稍后重试: ${id}`
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }
    if (depth > 0 || this.runningAgents.has(id)) {
      console.log(`[AgentService] runAgent(${id}) queued (depth=${depth + 1})`)
    }

    return this.runQueue.enqueue(id, (generation) =>
      this.executeRun(id, prompt, win, history, generation),
    )
  }

  /** 实际执行一次 Agent 运行(由 runAgent 队列串行调用),返回执行记录(含真实 status)。
   *  执行流程本体见 agent/execution.ts(纯重构搬移,this 依赖经 executionDeps 注入) */
  private async executeRun(
    id: string,
    prompt: string,
    win: BrowserWindow,
    history?: Array<{ role: string; content: string }>,
    generation?: number,
  ): Promise<AgentExecution | undefined> {
    return executeAgentRun(this.executionDeps, id, prompt, win, history, generation)
  }

  /** 中止正在运行的 Agent
   *  P1-40 修复:等 agent 进入 idle 状态后再返回(2 秒超时),避免前端误判
   */
  async abortAgent(id: string, win?: BrowserWindow): Promise<boolean> {
    const running = this.runningAgents.get(id)
    const queued = this.runQueue.abortQueued(id)
    if (!running && !queued) return false
    if (!running) {
      // 无在途运行(仅排队任务): 直接置 idle 并通知
      this.agentStatus.set(id, 'idle')
      this.sendStatus(win, id, 'idle', { aborted: true })
      return true
    }
    running.abortController.abort()
    try {
      await Promise.resolve(running.agent.abort())
    } catch (err) {
      console.warn(`[Agent] abort() threw for ${id}:`, err instanceof Error ? err.message : err)
    }
    // 短超时等 idle(abort 后 waitForIdle 通常立即 resolve)
    try {
      await withTimeout(running.agent.waitForIdle(), 2000, `Agent abort(${id})`)
    } catch (err) {
      console.warn(
        `[Agent] waitForIdle timed out for ${id}:`,
        err instanceof Error ? err.message : err,
      )
    }
    this.runningAgents.delete(id)
    this.agentStatus.set(id, 'idle')
    this.sendStatus(win, id, 'idle', { aborted: true })
    return true
  }

  /** 追加执行记录（保留最近 50 条） */
  private appendExecution(id: string, execution: AgentExecution) {
    const history = this.executionHistory.get(id) ?? []
    history.push(execution)
    if (history.length > 50) history.splice(0, history.length - 50)
    this.executionHistory.set(id, history)
  }

  /**
   * 应用退出时的优雅关闭:
   *   1. abort 所有正在运行的 agent(停止 LLM 调用 + 释放 pi-agent-core 资源)
   *   2. 清空排队队列(避免退出后排队任务出队执行,引用已销毁的 BrowserWindow)
   *   3. 销毁 MCP service(断开所有 MCP server 连接 + 杀掉 stdio 子进程)
   *
   * 此前 before-quit/will-quit 未调用本方法, 退出时:
   *   - 运行中的 agent 继续消耗 API token 直到进程被 OS 强杀
   *   - 排队任务可能出队执行, 引用已销毁的 win 导致 sendStatus 抛错
   *   - MCP stdio 子进程成为孤儿(Node 进程退出后子进程不自动终止)
   *
   * 超时保护: 整体 5 秒超时, 避免 abort/waitForIdle hang 阻塞退出。
   */
  async shutdown(): Promise<void> {
    const runningIds = Array.from(this.runningAgents.keys())
    if (runningIds.length > 0) {
      console.log(`[AgentService] shutdown: aborting ${runningIds.length} running agent(s)`)
    }
    // 清空所有排队队列(代数 +1 让出队任务放弃执行)
    this.runQueue.clearAllQueued()
    // 并发 abort 所有运行中的 agent, 每个 2 秒超时(复用 abortAgent 内部 waitForIdle 超时)
    const abortPromises = runningIds.map((id) =>
      this.abortAgent(id).catch((err) => {
        console.warn(`[AgentService] shutdown: abort ${id} failed:`, err)
      }),
    )
    // 整体 5 秒超时兜底, 防止某个 agent.abort() hang 阻塞退出
    await withTimeout(Promise.all(abortPromises), 5000, 'AgentService.shutdown abortAll').catch(
      () => {
        console.warn('[AgentService] shutdown: abortAll timed out after 5s, forcing cleanup')
      },
    )
    this.runningAgents.clear()

    // 销毁 MCP service(断开连接 + 杀 stdio 子进程)
    try {
      await mcpService.destroy()
    } catch (err) {
      console.warn('[AgentService] shutdown: mcpService.destroy failed:', err)
    }
    console.log('[AgentService] shutdown complete')
  }

  /** 统一发送 agent 状态更新到渲染进程(实现见 agent/status-tracking.ts) */
  private sendStatus(
    win: BrowserWindow | undefined,
    agentId: string,
    status: AgentStatus,
    extras: Record<string, unknown> = {},
  ) {
    sendAgentStatus(win, agentId, status, extras)
  }
}

export const agentService = new AgentService()
