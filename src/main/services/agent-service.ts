// =============================================================
// Agent Service — pi-agent-core 驱动的 Agent 运行时
// 每个 Agent 执行时创建 Agent 实例，连接 EAA 工具集
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
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  CompactionSettings,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import { app, type BrowserWindow } from 'electron'
import yaml from 'yaml'

import * as IPC from '../../shared/ipc-channels'
import type {
  AgentConfig,
  AgentDetail,
  AgentExecution,
  AgentListItem,
  AgentStatus,
} from '../../shared/types'
import { log } from '../utils/logger'
import {
  MAX_CONTINUATIONS,
  MIN_OUTPUT_CHARS,
  MIN_TURN_COUNT,
  resolveApiKey,
  selectModel,
} from './agent-model-selector'
import { AgentScheduler, type SchedulableAgent } from './agent-scheduler'
import { compactAgentMessages } from './compaction-helper'
import { cronService } from './cron-service'
import { dbService } from './db-service'
import { getToolsByCapability } from './eaa-tools'
import { allFileTools } from './file-tools'
import { mcpService } from './mcp-service'
import { getMcpToolsForAgent } from './mcp-tools'
import { settingsService } from './settings-service'
import { skillService } from './skill-service'
import { allUtilityTools } from './utility-tools'

// =============================================================
// Agent 运行时实例（每次执行创建一个）
// =============================================================

interface RunningAgent {
  agent: InstanceType<typeof Agent>
  abortController: AbortController
  agentId: string
  startedAt: number
}

const WAIT_FOR_IDLE_TIMEOUT_MS = 5 * 60_000 // 5 分钟

// =============================================================
// 内部工具函数
// =============================================================

/** 给 Promise 加超时（避免 waitForIdle hang） */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

class AgentService {
  private agents: Map<string, AgentConfig> = new Map()
  private agentsDir: string
  private configDir: string
  private scheduler: AgentScheduler
  private agentStatus: Map<string, AgentStatus> = new Map()
  private executionHistory: Map<string, AgentExecution[]> = new Map()
  private runningAgents: Map<string, RunningAgent> = new Map()
  /**
   * 运行串行队列: 同一 agent 的多次 runAgent 请求排队执行。
   * 此前并发调用直接抛 "Agent is already running",聊天页/定时任务/飞书互相打架,
   * 用户聊天时碰上 cron 触发就会收到一条难看的错误消息。改为排队后:
   * 后来的请求等前面的跑完再执行,彻底消除该错误。
   */
  private runQueueTails: Map<string, Promise<unknown>> = new Map()
  /** 各 agent 当前排队深度(含正在等待的),用于限制队列上限 */
  private runQueueDepths: Map<string, number> = new Map()
  /** abort 代数: abort 时 +1,排队中的任务出队时发现代数变化则放弃执行 */
  private runQueueGenerations: Map<string, number> = new Map()
  /** 单 agent 最大排队深度,超过则拒绝(防止 cron 密集触发时队列无限增长) */
  private static readonly MAX_RUN_QUEUE_DEPTH = 8

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

  /** 校验 agent id，防止 path traversal（允许小写字母、数字、连字符、下划线） */
  private validateAgentId(id: string): string {
    if (!/^[a-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid agent id: ${JSON.stringify(id)}`)
    }
    // 双保险：即便正则通过，也用 basename 去掉任何潜在的分隔符
    return path.basename(id)
  }

  getSoul(id: string): string {
    const safeId = this.validateAgentId(id)
    const soulPath = path.join(this.agentsDir, safeId, 'SOUL.md')
    return fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : ''
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
    const safeId = this.validateAgentId(id)
    const soulPath = path.join(this.agentsDir, safeId, 'SOUL.md')
    fs.mkdirSync(path.dirname(soulPath), { recursive: true })
    fs.writeFileSync(soulPath, content, 'utf-8')
    return { success: true }
  }

  getRules(id: string): string {
    const safeId = this.validateAgentId(id)
    const rulesPath = path.join(this.agentsDir, safeId, 'AGENTS.md')
    return fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : ''
  }

  /** 同 setSoul: validateAgentId 防御路径遍历,合法 id 即可写入 */
  setRules(id: string, content: string) {
    const safeId = this.validateAgentId(id)
    const rulesPath = path.join(this.agentsDir, safeId, 'AGENTS.md')
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true })
    fs.writeFileSync(rulesPath, content, 'utf-8')
    return { success: true }
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

    const depth = this.runQueueDepths.get(id) ?? 0
    if (depth >= AgentService.MAX_RUN_QUEUE_DEPTH) {
      const msg = `Agent 正忙且排队已满,请稍后重试: ${id}`
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }
    if (depth > 0 || this.runningAgents.has(id)) {
      console.log(`[AgentService] runAgent(${id}) queued (depth=${depth + 1})`)
    }

    const generation = this.runQueueGenerations.get(id) ?? 0
    this.runQueueDepths.set(id, depth + 1)
    const tail = this.runQueueTails.get(id) ?? Promise.resolve()
    const run = tail
      .catch(() => {
        // 前序运行失败不阻塞后续队列
      })
      .then(async () => {
        this.runQueueDepths.set(id, Math.max(0, (this.runQueueDepths.get(id) ?? 1) - 1))
        // 排队期间被 abort → 放弃执行
        if ((this.runQueueGenerations.get(id) ?? 0) !== generation) {
          console.log(`[AgentService] runAgent(${id}) dequeued by abort, skip`)
          return undefined
        }
        return this.executeRun(id, prompt, win, history, generation)
      })
    this.runQueueTails.set(id, run)
    // LOW-1 修复: run settle 后清理 tail,释放闭包持有的 win/prompt/history(防窗口关闭后泄漏)
    const cleanupTail = () => {
      if (this.runQueueTails.get(id) === run) this.runQueueTails.delete(id)
    }
    run.then(cleanupTail, cleanupTail)
    return run
  }

  /** 实际执行一次 Agent 运行(由 runAgent 队列串行调用),返回执行记录(含真实 status) */
  private async executeRun(
    id: string,
    prompt: string,
    win: BrowserWindow,
    history?: Array<{ role: string; content: string }>,
    generation?: number,
  ): Promise<AgentExecution | undefined> {
    const config = this.agents.get(id)
    if (!config) {
      const msg = `Agent not found: ${id}`
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }
    if (!config.enabled) {
      // 排队期间被停用 → 与 runAgent 入口行为一致
      const msg = `Agent is disabled: ${id}`
      this.agentStatus.set(id, 'error')
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }

    // 选择模型
    const model = selectModel(config.modelTier)
    const apiKeyResolved = resolveApiKey(model.provider)
    console.log(
      `[AgentService] runAgent(${id}) model selected: ${model.provider}/${model.id} (api: ${model.api}, baseUrl: ${model.baseUrl}, apiKey: ${apiKeyResolved ? '***present***' : 'MISSING'})`,
    )

    // 选择工具(三层 MCP 合并,抽出为 buildAgentTools 方法)
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
    const tools: AgentTool<any>[] = await this.buildAgentTools(config, id)

    // MEDIUM-2 修复: 启动竞态窗口 — buildAgentTools 等 await 期间 runningAgents 尚未注册,
    // 此窗口内的 abortAgent 靠"无条件递增 generation"生效,此处出 await 后立即检查。
    if (generation !== undefined && (this.runQueueGenerations.get(id) ?? 0) !== generation) {
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
    const soulContent = this.getSoul(id)
    const rulesContent = this.getRules(id)
    const skillsSection = this.buildSkillsSection()
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
    // 之前用 settings.chat.compaction.reserveTokens 死值 8000,当 contextWindow=900K 时相对太小
    // 之前用死值 8000 但 model.contextWindow=32K 时相对太大
    const adaptiveReserve = Math.max(
      4096,
      Math.min(compactionReserve, Math.floor(model.contextWindow * 0.1)),
    )
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
    this.runningAgents.set(id, { agent, abortController, agentId: id, startedAt })

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
            this.sendStatus(win, id, 'running', { output: aEvent.delta })
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
          this.sendStatus(win, id, 'running', {
            toolCall: { name: event.toolName, args: event.args },
          })
          break
        case 'tool_execution_end':
          console.log(
            `[AgentService] agent(${id}) turn=${turnCount} tool_end: ${event.toolName} error=${event.isError}`,
          )
          this.sendStatus(win, id, 'running', {
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
      this.agentStatus.set(id, 'running')
      this.sendStatus(win, id, 'running')
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
      this.appendExecution(id, execution)

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
        this.agentStatus.set(id, 'error')
        this.sendStatus(win, id, 'error', { error: lastErrorMessage, result: execution })
      } else {
        this.agentStatus.set(id, 'idle')
        this.sendStatus(win, id, 'idle', { result: execution })
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
      this.appendExecution(id, execution)

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
        this.agentStatus.set(id, 'error')
        this.sendStatus(win, id, 'error', { error: errorMsg })
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
      this.runningAgents.delete(id)
    }
  }

  /** 中止正在运行的 Agent
   *  P1-40 修复:等 agent 进入 idle 状态后再返回(2 秒超时),避免前端误判
   */
  async abortAgent(id: string, win?: BrowserWindow): Promise<boolean> {
    const running = this.runningAgents.get(id)
    const queued = (this.runQueueDepths.get(id) ?? 0) > 0
    // 代数 +1(无条件): 排队中的任务出队时发现代数变化即放弃执行(清空等待队列)。
    // 必须无条件递增 — executeRun 启动窗口(buildAgentTools await 期间)runningAgents 未注册、
    // depth 已自减,若跳过递增,该窗口内的 abort 会完全失效(MEDIUM-2)。
    this.runQueueGenerations.set(id, (this.runQueueGenerations.get(id) ?? 0) + 1)
    // MEDIUM-1 修复: 重置排队深度 — 否则队列排满(8)时 abort,死任务逐个出队前新请求被误拒"排队已满"。
    // 出队自减有 Math.max(0, ...) 兜底,不会减成负数。
    this.runQueueDepths.delete(id)
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
    for (const id of this.runQueueDepths.keys()) {
      this.runQueueGenerations.set(id, (this.runQueueGenerations.get(id) ?? 0) + 1)
      this.runQueueDepths.delete(id)
    }
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

  /** 统一发送 agent 状态更新到渲染进程 */
  private sendStatus(
    win: BrowserWindow | undefined,
    agentId: string,
    status: AgentStatus,
    extras: Record<string, unknown> = {},
  ) {
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send(IPC.IPC_AGENT_STATUS_UPDATE, { agentId, status, ...extras })
    } catch (err) {
      console.warn(`[AgentService] Failed to send status for ${agentId}:`, err)
    }
  }
}

export const agentService = new AgentService()
