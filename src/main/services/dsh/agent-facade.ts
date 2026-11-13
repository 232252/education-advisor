// =============================================================
// pi Agent 的 dsh 替身（供 agent/execution.ts 使用）
//
// execution 只用到 Agent 的这几个成员：
//   subscribe(handler) → unsubscribe、prompt(text)、waitForIdle()、
//   state.tools、state.messages、abort()
// 本类以同样的面暴露 dsh：prompt 启动一轮并把 SessionEvent 投影成
// AgentEvent 推给订阅者，turn/end 释放 idle。
//
// 与 pi 路径的两处真实差异（不做静默近似）：
// 1) 工具不再逐个注册：每次运行由 tool-bridge 挂一个只含该角色工具的 MCP 端点，
//    所以 state.tools 的赋值只是记录（dsh 侧可见集 = 那份 patch 里的端点）。
// 2) 会话历史由 dsh 自己持有；SDK 没有「注入历史消息」的入口，所以
//    state.messages 被写入后，会在下一次 prompt 时渲染成文本前缀带过去。
// =============================================================

import type { AgentEvent, AgentMessage, Api, Model } from '@main/services/llm-contracts'
import { DshAgentEventProjector } from './agent-events'
import { isDshSupportedImage } from './one-shot'
import type { DshChatStreamParams, DshPromptBlock, DshPromptImageBlock } from './runtime'
import { isSlashInput } from './slash-commands'
import { rewriteToolNames } from './tool-names'
import type { DshSessionEvent } from './wire-types'

type Listener = (event: AgentEvent) => void

/** 只需原始 turn 流 + 关闭能力；DshRuntime 即其实现，测试可注入替身 */
export interface DshTurnSource {
  turnEvents(params: DshChatStreamParams): AsyncGenerator<DshSessionEvent>
  dispose(): Promise<void>
}

export interface DshAgentFacadeInit {
  runtime: DshTurnSource
  model: Model<Api>
  systemPrompt: string
  /** dsh 路由名；与 model.provider/id 一致，显式传入避免歧义 */
  providerId?: string
  modelId?: string
  /**
   * 原名 → 模型可见名。给了就改写 system prompt（dsh 侧工具被强制加
   * mcp__<server>__ 前缀，不改写会让模型按提示里的旧名字调用不存在的工具）；
   * 用户消息不动，避免污染学生数据。
   */
  toolNameMap?: Readonly<Record<string, string>>
  /**
   * 说明已经写进这个子进程的 DSH_AGENTS_HOME/AGENTS.md。
   * 不再把同一段文字放进用户消息，避免和 agent-instructions 重复。
   */
  instructionsViaAgentsHome?: boolean
  /**
   * 原生多轮会话键（通常是 agent id）。给了就走 dsh 持久化会话：只发本轮新
   * 消息，历史由 dsh 持有/恢复，不再拼文本前缀。省略维持老路径。
   */
  sessionKey?: string
  /** 会话有效工作目录（绝对路径）；随每轮 prompt 绑给 dsh */
  workingDirectory?: string
}

/**
 * AgentMessage 是联合（BashExecutionMessage 等没有 content），
 * 必须先 in 收窄；content 可能是字符串或内容块数组。
 */
function messageText(message: AgentMessage): string {
  if (!('content' in message)) return ''
  const content = message.content
  if (typeof content === 'string') return content
  return content
    .map((part) => {
      if (part.type === 'text') return part.text
      if (part.type === 'image') return `[image ${part.mimeType}]`
      if (part.type === 'toolCall') return `[toolCall ${part.name}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * 智能体链路的 dsh 后端入口。
 *
 * 工具面由调用方（agent/execution.ts）在挂载阶段决定：每次运行经
 * mountEaaAgentTools 换一个只含该角色工具的 MCP 端点，dsh 子进程只读这一份
 * patch，所以逐角色最小权限在这里已经成立。保留这个工厂函数是为了让执行链路
 * 有一个可注入的构造点（测试据此替换实例）。
 *
 * chat 与批改链路没有工具面（pi 路径同样不传 tools），不受此影响。
 */
export function createDshAgent(init: DshAgentFacadeInit): DshAgentFacade {
  return new DshAgentFacade(init)
}

export class DshAgentFacade {
  state: { tools: unknown[]; messages: AgentMessage[] } = { tools: [], messages: [] }

  private readonly listeners = new Set<Listener>()
  private readonly systemPrompt: string
  private idleWaiters: (() => void)[] = []
  private busy = false
  private disposed = false
  private projector: DshAgentEventProjector | null = null

  constructor(private readonly init: DshAgentFacadeInit) {
    this.systemPrompt = init.toolNameMap
      ? rewriteToolNames(init.systemPrompt, init.toolNameMap)
      : init.systemPrompt
  }

  subscribe(handler: Listener): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /** 上一次 prompt 之后是否已结束（测试与调用方判定用） */
  get isIdle(): boolean {
    return !this.busy
  }

  /** 本轮结束原因；未结束为 null */
  get outcome(): { aborted: boolean; failed: boolean } | null {
    if (this.busy || !this.projector) return null
    return { aborted: this.projector.result.aborted, failed: this.projector.result.failed }
  }

  private renderHistory(): string {
    if (!this.state.messages.length) return ''
    return this.state.messages
      .map((m) => ({ role: m.role, text: messageText(m) }))
      .filter((entry) => entry.text.length > 0)
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join('\n')
  }

  /**
   * 历史里的图片按出现顺序取出来。pi 是把图片块随消息一起发给 provider 的，
   * 之前这里只留 `[image mime]` 文本标记 ⇒ 同一份图文上下文，pi 路径看得见图、
   * dsh 路径看不见（agent 用 read_image 查看试卷就等于没看）。
   * dsh 不受理的 mime 仍然只有标记：把不支持的格式静默丢掉比报错更难查。
   */
  private historyImages(): DshPromptImageBlock[] {
    const images: DshPromptImageBlock[] = []
    for (const message of this.state.messages) {
      if (!('content' in message) || typeof message.content === 'string') continue
      for (const part of message.content) {
        if (part.type !== 'image') continue
        if (isDshSupportedImage(part.mimeType)) {
          images.push({ type: 'image', data: part.data, mimeType: part.mimeType })
        }
      }
    }
    return images
  }

  /** 启动一轮。上一轮未结束就再次调用属于用法错误（续跑循环总会先 await idle） */
  async prompt(text: string): Promise<void> {
    if (this.disposed) throw new Error('dsh agent 运行时已关闭')
    if (this.busy) throw new Error('上一轮 dsh turn 尚未结束')

    this.busy = true
    this.projector = new DshAgentEventProjector({
      model: this.init.model,
      systemPrompt: this.systemPrompt,
      userPrompt: text,
    })

    // 斜杠指令：整行原样交给 DSH 原生 session/query 路由，不拼历史前缀、
    // 不附历史图片（指令的输入语义由 DSH parseCommand 决定）。
    const command = isSlashInput(text)

    // 原生多轮：历史由 dsh 持久化持有，只发本轮新消息；图片仍随本轮附上
    // （dsh 的 resume 恢复的是文本上下文，图片块不持久化）。
    const native = Boolean(this.init.sessionKey)
    const history = native || command ? '' : this.renderHistory()
    const blocks: DshPromptBlock[] = [
      { type: 'text', text: history ? `${history}\n${text}` : text },
    ]
    const images = command ? [] : this.historyImages()
    if (images.length) {
      blocks.push({
        type: 'text',
        text: `\n上述标记的图片按出现顺序随附于此，共 ${images.length} 张：\n`,
      })
      blocks.push(...images)
    }

    void this.pump(blocks, command)
  }

  private async pump(blocks: DshPromptBlock[], command = false): Promise<void> {
    const projector = this.projector as DshAgentEventProjector
    try {
      for await (const event of this.init.runtime.turnEvents({
        providerId: this.init.providerId ?? String(this.init.model.provider),
        modelId: this.init.modelId ?? this.init.model.id,
        messages: [],
        systemPrompt: this.init.instructionsViaAgentsHome ? '' : this.systemPrompt,
        blocks,
        ...(this.init.sessionKey ? { sessionKey: this.init.sessionKey } : {}),
        ...(this.init.workingDirectory ? { workingDirectory: this.init.workingDirectory } : {}),
        ...(command ? { command: true } : {}),
      })) {
        for (const mapped of projector.project(event)) this.emit(mapped)
      }
    } catch (err) {
      // 订阅者按 AgentEvent 消费；异常没有对应事件形状。这里要区分「用户按了停止」
      // （abort 会关掉子进程，所以打断一定以抛错收尾）与真失败，并且两种情况都要
      // 补发 turn_end + agent_end：pi 路径的每一轮都以这一对结束，collector 与
      // execution 的收尾逻辑都挂在上面。
      const closing = this.disposed
        ? projector.markAbort()
        : projector.markFailure(err instanceof Error ? err.message : String(err))
      for (const mapped of closing) this.emit(mapped)
      console.warn('[DshAgentFacade] turn 中断:', err instanceof Error ? err.message : err)
    } finally {
      this.busy = false
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  waitForIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  /**
   * 中止当前轮。SDK 没有按 turn 取消的方法，只能关掉子进程 ——
   * 因此每个 agent 执行必须独占一个 DshRuntime，否则会同杀其它并发会话。
   */
  async abort(): Promise<void> {
    this.disposed = true
    const runtime = this.init.runtime
    try {
      await runtime.dispose()
    } catch (err) {
      console.warn('[DshAgentFacade] dispose 失败（忽略）:', err)
    }
    this.busy = false
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}
