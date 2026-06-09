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
import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  CompactionSettings,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getEnvApiKey, getModel, getModels, getProviders } from '@earendil-works/pi-ai'
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
import { compactAgentMessages } from './compaction-helper'
import { cronService } from './cron-service'
import { dbService } from './db-service'
import { getToolsByCapability } from './eaa-tools'
import { allFileTools } from './file-tools'
import { keystoreService } from './keystore-service'
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

/** agent → cron task id 列表的映射（用于聚合 nextRunAt） */
type AgentScheduleMap = Map<string, string[]>

/** 用户对 agents.yaml 的覆盖（enabled/name/description/modelTier/capabilities 均可被覆盖） */
interface UserAgentOverride {
  enabled?: boolean
  name?: string
  description?: string
  modelTier?: 'high_quality' | 'low_cost'
  capabilities?: string[]
}

const WAIT_FOR_IDLE_TIMEOUT_MS = 5 * 60_000 // 5 分钟
const MAX_CONTINUATIONS = 5 // 模型提前结束时最多续跑次数
const MIN_OUTPUT_CHARS = 200 // 输出少于此字符时触发续跑
const MIN_TURN_COUNT = 3 // 轮次少于此数时触发续跑

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

/** 防御性 NaN guard：cost 字段可能为 undefined 或非有限数 */
function safeCostScore(m: Model<Api>): number {
  const input = Number.isFinite(m.cost?.input) ? m.cost.input : Number.POSITIVE_INFINITY
  const output = Number.isFinite(m.cost?.output) ? m.cost.output : Number.POSITIVE_INFINITY
  return input + output
}

class AgentService {
  private agents: Map<string, AgentConfig> = new Map()
  private agentsDir: string
  private configDir: string
  private userOverrides: Map<string, UserAgentOverride> = new Map()
  private userOverridesPath: string
  private agentStatus: Map<string, AgentStatus> = new Map()
  private executionHistory: Map<string, AgentExecution[]> = new Map()
  private runningAgents: Map<string, RunningAgent> = new Map()
  private agentScheduleTasks: AgentScheduleMap = new Map()

  constructor() {
    this.agentsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'agents')
      : path.join(__dirname, '..', '..', 'agents')

    this.configDir = app.isPackaged
      ? path.join(process.resourcesPath, 'config')
      : path.join(__dirname, '..', '..', 'config')

    this.userOverridesPath = path.join(app.getPath('userData'), 'agents.user.yaml')
  }

  /** 初始化：加载 Agent、注册 cron 调度、桥接执行函数 */
  async init(_win: BrowserWindow): Promise<void> {
    await this.loadUserOverrides()
    await this.loadAgents()

    // 将 runAgent 注册给 cron service，作为定时任务的执行入口
    cronService.setAgentRunner((agentId, prompt, w) => this.runAgent(agentId, prompt, w))

    // 将 agent 的 schedule 字段同步为 cron 任务
    this.syncSchedules()

    console.log(`[AgentService] Initialized with ${this.agents.size} agents`)
  }

  /** 同步 agent schedule 到 cron（同时记录 agent → task 映射，P1-1 准备） */
  private syncSchedules() {
    const agents = Array.from(this.agents.values())
      .filter((a) => a.enabled && a.schedule.length > 0)
      .map((a) => ({ id: a.id, name: a.name, schedule: a.schedule, modelTier: a.modelTier }))

    const taskIds = cronService.syncAgentSchedules(agents)
    this.agentScheduleTasks = taskIds
  }

  // ===========================================================
  // 配置管理
  // ===========================================================

  /** 加载 user overrides（独立 yaml，保留主 yaml 注释） */
  private async loadUserOverrides(): Promise<void> {
    try {
      await fsp.access(this.userOverridesPath, fs.constants.F_OK)
    } catch {
      return
    }
    try {
      const content = await fsp.readFile(this.userOverridesPath, 'utf-8')
      const parsed = yaml.parse(content)
      const list =
        parsed && typeof parsed === 'object' && Array.isArray(parsed.agents) ? parsed.agents : []
      for (const a of list) {
        if (a && typeof a.id === 'string') {
          const override: UserAgentOverride = {}
          if (typeof a.enabled === 'boolean') override.enabled = a.enabled
          if (typeof a.name === 'string') override.name = a.name
          if (typeof a.description === 'string') override.description = a.description
          if (a.modelTier === 'high_quality' || a.modelTier === 'low_cost')
            override.modelTier = a.modelTier
          if (Array.isArray(a.capabilities)) override.capabilities = a.capabilities
          this.userOverrides.set(a.id, override)
        }
      }
      console.log(`[AgentService] Loaded ${this.userOverrides.size} user overrides`)
    } catch (err) {
      console.warn('[AgentService] Failed to load user overrides:', err)
    }
  }

  /** 持久化 user overrides（写回 agents.user.yaml） */
  private async persistUserOverrides(): Promise<void> {
    const list = Array.from(this.userOverrides.entries())
      .filter(([, v]) => v && Object.keys(v).length > 0)
      .map(([id, v]) => {
        const entry: {
          id: string
          enabled?: boolean
          name?: string
          description?: string
          modelTier?: 'high_quality' | 'low_cost'
          capabilities?: string[]
        } = { id }
        if (typeof v.enabled === 'boolean') entry.enabled = v.enabled
        if (typeof v.name === 'string') entry.name = v.name
        if (typeof v.description === 'string') entry.description = v.description
        if (v.modelTier === 'high_quality' || v.modelTier === 'low_cost')
          entry.modelTier = v.modelTier
        if (Array.isArray(v.capabilities)) entry.capabilities = v.capabilities
        return entry
      })
    const payload = `\
# Education Advisor Agent 用户覆盖配置
# 此文件由 UI 自动生成,主配置文件 config/agents.yaml 不会被修改
# 仅记录用户在 UI 中改过的字段（enabled/name/description/modelTier/capabilities）
# 删除此文件可重置所有覆盖
${yaml.stringify({ agents: list })}
`
    const tmpPath = `${this.userOverridesPath}.tmp`
    try {
      await fsp.mkdir(path.dirname(this.userOverridesPath), { recursive: true })
      await fsp.writeFile(tmpPath, payload, 'utf-8')
      await fsp.rename(tmpPath, this.userOverridesPath)
    } catch (err) {
      console.error('[AgentService] Failed to persist user overrides:', err)
    }
  }

  /** 从 agents.yaml 加载 Agent 配置（叠加 user overrides） */
  async loadAgents(): Promise<void> {
    const yamlPath = path.join(this.configDir, 'agents.yaml')
    if (!fs.existsSync(yamlPath)) {
      console.warn('[AgentService] agents.yaml not found, using empty config')
      return
    }

    const content = fs.readFileSync(yamlPath, 'utf-8')
    const parsed = yaml.parse(content)
    const agentList = parsed.agents ?? []

    for (const a of agentList) {
      const override = this.userOverrides.get(a.id)
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
      }
      this.agents.set(config.id, config)
      this.agentStatus.set(config.id, 'idle')
    }

    console.log(`[AgentService] Loaded ${this.agents.size} agents`)
  }

  /** 聚合 agent 下次执行时间（取所有 schedule 中最早的 ISO 时间戳） */
  private getNextRunAt(agentId: string): number | undefined {
    const taskIds = this.agentScheduleTasks.get(agentId)
    if (!taskIds || taskIds.length === 0) return undefined
    let earliest: number | undefined
    for (const id of taskIds) {
      const iso = cronService.getNextRunAt(id)
      if (!iso) continue
      const ts = new Date(iso).getTime()
      if (Number.isFinite(ts) && (earliest === undefined || ts < earliest)) {
        earliest = ts
      }
    }
    return earliest
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
        nextRunAt: this.getNextRunAt(config.id),
      }
    })
  }

  /** 获取 Agent 详情 */
  async getAgent(id: string): Promise<AgentDetail | null> {
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
      nextRunAt: this.getNextRunAt(id),
    }
  }

  /** 启用/禁用 Agent — 持久化到 user overrides + 触发 cron 同步 */
  toggleAgent(id: string, enabled: boolean) {
    const config = this.agents.get(id)
    if (!config) return { success: false, error: 'Agent not found' }
    config.enabled = enabled
    this.userOverrides.set(id, { ...(this.userOverrides.get(id) ?? {}), enabled })
    void this.persistUserOverrides()
    // 重新同步 schedule:disable 的 agent 对应 cron 任务会被停用
    this.syncSchedules()
    return { success: true }
  }

  /** 更新 Agent 配置（name, description, modelTier, capabilities 等） */
  updateAgent(
    id: string,
    patch: Partial<Pick<AgentConfig, 'name' | 'description' | 'modelTier' | 'capabilities'>>,
  ): { success: boolean; error?: string } {
    const config = this.agents.get(id)
    if (!config) return { success: false, error: 'Agent not found' }
    if (patch.name !== undefined) config.name = patch.name
    if (patch.description !== undefined) config.description = patch.description
    if (patch.modelTier !== undefined) config.modelTier = patch.modelTier
    if (patch.capabilities !== undefined) config.capabilities = patch.capabilities
    // 持久化到 user overrides
    this.userOverrides.set(id, { ...(this.userOverrides.get(id) ?? {}), ...patch })
    void this.persistUserOverrides()
    this.syncSchedules()
    return { success: true }
  }

  getSoul(id: string): string {
    const soulPath = path.join(this.agentsDir, id, 'SOUL.md')
    return fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : ''
  }

  setSoul(id: string, content: string) {
    const soulPath = path.join(this.agentsDir, id, 'SOUL.md')
    fs.mkdirSync(path.dirname(soulPath), { recursive: true })
    fs.writeFileSync(soulPath, content, 'utf-8')
    return { success: true }
  }

  getRules(id: string): string {
    const rulesPath = path.join(this.agentsDir, id, 'AGENTS.md')
    return fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : ''
  }

  setRules(id: string, content: string) {
    const rulesPath = path.join(this.agentsDir, id, 'AGENTS.md')
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
  // 模型选择
  // ===========================================================

  /** 检查指定 provider 是否配置了可用的 API key */
  private hasApiKey(provider: string): boolean {
    return !!(keystoreService.getApiKey(provider) || getEnvApiKey(provider))
  }

  /** 从 settings 自定义模型中构造 Model<Api> 兼容对象（与 pi-ai-service.resolveModel 逻辑一致） */
  private resolveCustomModel(providerId: string, modelId: string): Model<Api> | undefined {
    const settings = settingsService.getSettings()
    const customModels = settings.models.customModels?.[providerId]
    if (!customModels || customModels.length === 0) return undefined

    const custom = customModels.find((m) => m.id === modelId)
    if (!custom) return undefined

    // 从 provider 静态模型获取默认 api 和 baseUrl
    let defaultApi = 'openai-completions'
    let defaultBaseUrl = ''
    try {
      const staticModels = getModels(providerId as Parameters<typeof getModels>[0])
      if (staticModels.length > 0) {
        defaultApi = staticModels[0].api
        defaultBaseUrl = staticModels[0].baseUrl
      }
    } catch {
      // provider 不在静态注册表，使用默认值
    }

    const model: Model<Api> = {
      id: custom.id,
      name: custom.name,
      api: (custom.api ?? defaultApi) as Api,
      provider: providerId as Model<Api>['provider'],
      baseUrl: custom.baseUrl ?? defaultBaseUrl,
      reasoning: custom.supportsReasoning ?? false,
      input: ['text'],
      cost: {
        input: custom.costPerInputToken ?? 0,
        output: custom.costPerOutputToken ?? 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      // 修复 Bug-1: 真正透传用户填的 contextWindow
      // 1) 用户填了 → 用用户的 (log 标 from settings)
      // 2) 用户没填 → 默认 900K (与 SettingsPage 对齐)
      // 3) 最后才 32768
      contextWindow:
        typeof custom.contextWindow === 'number' && custom.contextWindow > 0
          ? custom.contextWindow
          : 900000,
      maxTokens: custom.maxOutputTokens ?? 4096,
    }

    console.log(
      `[AgentService] Resolved custom model: ${providerId}/${modelId} (api: ${model.api}, baseUrl: ${model.baseUrl}, contextWindow: ${model.contextWindow} ${typeof custom.contextWindow === 'number' ? '(from settings)' : '(default 900K)'})`,
    )
    return model
  }

  /**
   * 根据 modelTier 选择模型(支持自定义 provider + API key 验证)
   * 修复 Bug-1: 用户的 defaultProvider + defaultModel(含 900K contextWindow 等自定义)必须能传过来
   * 之前 tier 路径不读 defaultModel, 选了 tier 标签但用了 static 注册表的 model(默认 32K)
   */
  private selectModel(tier: 'high_quality' | 'low_cost'): Model<Api> {
    const settings = settingsService.getSettings()
    const providerId = settings.models.defaultProvider
    // 优先 defaultModel(用户在 Models 页面选的那个,含自定义 900K contextWindow)
    // 然后是 tier 对应的 highQualityModel/lowCostModel
    let modelId = settings.models.defaultModel
    if (!modelId) {
      modelId =
        tier === 'high_quality' ? settings.models.highQualityModel : settings.models.lowCostModel
    }

    console.log(
      `[AgentService] selectModel: tier=${tier} provider=${providerId} model=${modelId} (using defaultModel first to inherit user's selected model contextWindow)`,
    )

    // 1. 尝试使用配置的具体模型（静态注册表 + 自定义模型回退）
    if (modelId && providerId && this.hasApiKey(providerId)) {
      // 1a. 静态注册表（注意：getModel 找不到时返回 undefined，不抛异常）
      const staticModel = getModel(
        providerId as Parameters<typeof getModel>[0],
        modelId as Parameters<typeof getModel>[1],
      )
      if (staticModel) {
        console.log(`[AgentService] selectModel: using static model ${providerId}/${modelId}`)
        return staticModel
      }
      // 1b. 自定义模型（settings.models.customModels）
      const custom = this.resolveCustomModel(providerId, modelId)
      if (custom) {
        console.log(`[AgentService] selectModel: using custom model ${providerId}/${modelId}`)
        return custom
      }
    } else if (modelId && providerId) {
      console.log(
        `[AgentService] selectModel: configured provider ${providerId} has no API key, skipping`,
      )
    }

    // 2. 尝试默认 provider 的任意可用模型（含自定义模型）
    if (providerId && this.hasApiKey(providerId)) {
      // 2a. 静态模型
      try {
        const models = getModels(providerId as Parameters<typeof getModels>[0])
        if (models.length > 0) {
          const selected =
            tier === 'high_quality'
              ? models.reduce((best, m) => (safeCostScore(m) > safeCostScore(best) ? m : best))
              : models.reduce((cheapest, m) =>
                  safeCostScore(m) < safeCostScore(cheapest) ? m : cheapest,
                )
          console.log(
            `[AgentService] selectModel: using provider ${providerId} auto-selected ${selected.id}`,
          )
          return selected
        }
      } catch {
        // 静态模型查找失败（如自定义 provider），继续尝试自定义模型
      }

      // 2b. 自定义模型列表
      const customModels = settings.models.customModels?.[providerId]
      if (customModels && customModels.length > 0) {
        const cm = customModels[0]
        const resolved = this.resolveCustomModel(providerId, cm.id)
        if (resolved) {
          console.log(`[AgentService] selectModel: using first custom model ${providerId}/${cm.id}`)
          return resolved
        }
      }
    }

    // 3. 遍历所有已配置 API key 的 provider（静态 + 自定义）
    console.log('[AgentService] selectModel: falling back to scanning all providers with API keys')
    const allProviderIds = getProviders()
    for (const pid of allProviderIds) {
      if (!this.hasApiKey(pid)) continue
      // 3a. 先尝试静态模型
      try {
        const models = getModels(pid as Parameters<typeof getModels>[0])
        if (models.length > 0) {
          const selected =
            tier === 'high_quality'
              ? models.reduce((best, m) => (safeCostScore(m) > safeCostScore(best) ? m : best))
              : models.reduce((cheapest, m) =>
                  safeCostScore(m) < safeCostScore(cheapest) ? m : cheapest,
                )
          console.log(`[AgentService] selectModel: fallback to ${pid}/${selected.id}`)
          return selected
        }
      } catch {
        // continue
      }

      // 3b. 也检查该 provider 的自定义模型
      const customModels = settings.models.customModels?.[pid]
      if (customModels && customModels.length > 0) {
        const cm = customModels[0]
        const resolved = this.resolveCustomModel(pid, cm.id)
        if (resolved) {
          console.log(`[AgentService] selectModel: fallback to custom ${pid}/${cm.id}`)
          return resolved
        }
      }
    }

    // 4. 最终回退：尝试常见模型（仅当有对应 API key 时）
    const fallbacks: Array<[string, string]> = [
      ['anthropic', 'claude-sonnet-4-20250514'],
      ['openai', 'gpt-4o-mini'],
      ['deepseek', 'deepseek-chat'],
    ]
    for (const [p, m] of fallbacks) {
      if (!this.hasApiKey(p)) continue
      const model = getModel(
        p as Parameters<typeof getModel>[0],
        m as Parameters<typeof getModel>[1],
      )
      if (model) {
        console.log(`[AgentService] selectModel: last-resort fallback to ${p}/${m}`)
        return model
      }
    }

    throw new Error(
      'No model available with a configured API key. Please add an API key in Model Management.',
    )
  }

  /** 获取 API Key */
  private resolveApiKey(provider: string): string | undefined {
    return keystoreService.getApiKey(provider) ?? getEnvApiKey(provider) ?? undefined
  }

  // ===========================================================
  // Agent 执行 — 接入 pi-agent-core
  // ===========================================================

  /** 手动运行 Agent（通过 pi-agent-core Agent 类） */
  async runAgent(
    id: string,
    prompt: string,
    win: BrowserWindow,
    history?: Array<{ role: string; content: string }>,
  ): Promise<void> {
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

    // 检查是否有正在运行的实例
    if (this.runningAgents.has(id)) {
      const msg = `Agent is already running: ${id}`
      this.sendStatus(win, id, 'error', { error: msg })
      throw new Error(msg)
    }

    // 更新状态为 running
    this.agentStatus.set(id, 'running')
    this.sendStatus(win, id, 'running')

    // 选择模型
    const model = this.selectModel(config.modelTier)
    const apiKeyResolved = this.resolveApiKey(model.provider)
    console.log(
      `[AgentService] runAgent(${id}) model selected: ${model.provider}/${model.id} (api: ${model.api}, baseUrl: ${model.baseUrl}, apiKey: ${apiKeyResolved ? '***present***' : 'MISSING'})`,
    )

    // 选择工具
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
    const tools: AgentTool<any>[] = [
      ...getToolsByCapability(config.capabilities),
      ...allFileTools, // 文件工具（read_file, read_excel, write_excel, write_csv, list_dir）
      ...allUtilityTools, // 实用工具（get_current_time, calculate）
    ]

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
      const key = this.resolveApiKey(model.provider) ?? getEnvApiKey(model.provider)
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
        thinkingLevel: 'medium' as ThinkingLevel,
        // ✅ 从模型定义中读取 maxTokens 作为单次输出上限
        // (pi-agent-core 会根据 model.maxTokens 向 LLM 请求对应数量的 token)
      },
      getApiKey: (provider: string) => this.resolveApiKey(provider),
      transformContext,
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

    // 记录执行到 DB
    const dbExecId = dbService.recordExecutionStart(id, prompt)

    // 订阅事件，转发到渲染进程 + 收集诊断信息
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_update': {
          const aEvent = event.assistantMessageEvent
          if (aEvent && aEvent.type === 'text_delta') {
            outputText += aEvent.delta
            this.sendStatus(win, id, 'running', { output: aEvent.delta })
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
          const msg = event.message as { stopReason?: string; content?: Array<{ type?: string }> }
          const tcInTurn = Array.isArray(msg?.content)
            ? msg.content.filter((c) => c.type === 'toolCall').length
            : 0
          console.log(
            `[AgentService] agent(${id}) turn ${turnCount} ended: stopReason=${msg?.stopReason ?? '?'} tools=${tcInTurn} outputLen=${outputText.length}`,
          )
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
      // ── 执行 Agent（含智能续跑）──
      console.log(`[AgentService] runAgent(${id}) calling agent.prompt()...`)
      await agent.prompt(prompt)
      console.log(`[AgentService] runAgent(${id}) prompt() resolved, waiting for idle...`)
      await withTimeout(agent.waitForIdle(), WAIT_FOR_IDLE_TIMEOUT_MS, `Agent waitForIdle(${id})`)
      console.log(
        `[AgentService] runAgent(${id}) first pass: turns=${turnCount} outputLen=${outputText.length} toolCalls=${toolCallCount}`,
      )

      // ── 智能续跑循环 ──
      // 当模型过早结束（输出短 AND 轮次少）时，发送续跑提示让模型继续完成任务
      let continuationCount = 0
      while (
        continuationCount < MAX_CONTINUATIONS &&
        outputText.length < MIN_OUTPUT_CHARS &&
        turnCount < MIN_TURN_COUNT &&
        !abortController.signal.aborted
      ) {
        continuationCount++
        const remainingTasks = Math.max(0, MIN_TURN_COUNT - turnCount)
        const contPrompt =
          `[系统指令] 你的回复过早结束。你只完成了 ${turnCount} 轮操作，输出了 ${outputText.length} 个字符。` +
          `用户的任务需要更多步骤才能完成。请继续使用可用工具完成任务，至少还需执行 ${remainingTasks} 轮操作。` +
          `不要只说一句概述就停止，要积极调用工具执行实际操作。`
        console.log(
          `[AgentService] runAgent(${id}) continuation #${continuationCount}: turns=${turnCount} outputLen=${outputText.length}`,
        )
        turnCount = 0
        await agent.prompt(contPrompt)
        await withTimeout(
          agent.waitForIdle(),
          WAIT_FOR_IDLE_TIMEOUT_MS,
          `Agent waitForIdle(${id}) cont#${continuationCount}`,
        )
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

      // 记录执行历史
      const execution: AgentExecution = {
        id: `exec_${Date.now()}`,
        agentId: id,
        prompt,
        output: outputText,
        startedAt,
        durationMs: Date.now() - startedAt,
        tokenUsage: {
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        cost: totalCost,
        status: 'success',
      }
      this.appendExecution(id, execution)

      // 同步写入 DB
      if (dbExecId >= 0) {
        dbService.updateExecution(dbExecId, {
          status: 'success',
          output: outputText,
          tokensInput: inputTokens,
          tokensOutput: outputTokens,
          costTotal: totalCost,
        })
      }

      // 更新状态
      this.agentStatus.set(id, 'idle')
      this.sendStatus(win, id, 'idle', { result: execution })
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const execution: AgentExecution = {
        id: `exec_${Date.now()}`,
        agentId: id,
        prompt,
        output: outputText || errorMsg,
        startedAt,
        durationMs: Date.now() - startedAt,
        tokenUsage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: totalCost,
        status: abortController.signal.aborted ? 'timeout' : 'error',
      }
      this.appendExecution(id, execution)

      // 同步写入 DB
      if (dbExecId >= 0) {
        dbService.updateExecution(dbExecId, {
          status: abortController.signal.aborted ? 'aborted' : 'failure',
          output: outputText || errorMsg,
          error: errorMsg,
          tokensInput: inputTokens,
          tokensOutput: outputTokens,
          costTotal: totalCost,
        })
      }

      this.agentStatus.set(id, 'error')
      this.sendStatus(win, id, 'error', { error: errorMsg })
    } finally {
      unsubscribe()
      this.runningAgents.delete(id)
    }
  }

  /** 中止正在运行的 Agent
   *  P1-40 修复:等 agent 进入 idle 状态后再返回(2 秒超时),避免前端误判
   */
  async abortAgent(id: string, win?: BrowserWindow): Promise<boolean> {
    const running = this.runningAgents.get(id)
    if (!running) return false
    running.abortController.abort()
    try {
      await Promise.resolve(running.agent.abort())
    } catch {
      // agent.abort() 内部可能 throw,忽略
    }
    // 短超时等 idle(abort 后 waitForIdle 通常立即 resolve)
    try {
      await withTimeout(running.agent.waitForIdle(), 2000, `Agent abort(${id})`)
    } catch {
      // 超时或异常也认为已尽力 abort
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
