// =============================================================
// FeishuCommandRouter — 飞书斜杠命令路由器
// 解析飞书消息中的 "/命令 参数" 并分发到对应处理器。
//
// 设计:
//   - parseCommand(): 纯函数,只做文本解析(可单测,无副作用)
//   - CommandRouter:  可扩展注册表,register/dispatch
//   - CommandContext:  能力注入接口(EAA / Agent 列表 / Agent 运行)
//                     由调用方(feishu-bot-service)提供实现,避免本模块
//                     直接依赖主进程单例(eaa-bridge 在 Electron 环境外
//                     无法实例化),保持本模块可在 vitest 中直接测试。
// =============================================================

/**
 * EAA 命令执行结果(与 eaa-bridge 的 EAAResult 结构一致,此处内联定义
 * 以避免本模块引入 eaa-bridge 的 Electron 依赖)。
 */
export interface EAAResultLike {
  success: boolean
  data: unknown | null
  stderr: string
  exitCode: number
}

/** 从 EAA 结果中提取最有用的错误信息(优先 data,其次 stderr) */
function getErrorMessage(result: EAAResultLike, fallback = '未知错误'): string {
  if (typeof result.data === 'string' && result.data.length > 0) return result.data
  if (result.stderr && result.stderr.length > 0) return result.stderr
  return fallback
}

/** 命令解析结果 */
export interface ParsedCommand {
  command: string // 不含 '/',已转小写
  args: string[] // 按空白拆分的参数
  rawArgs: string // 原始参数字符串(保留引号等)
}

/**
 * 解析一行文本是否为斜杠命令。
 * @returns 命令对象;若不是命令(不以 / 开头)返回 null。
 * @example
 *   parseCommand('/help')           → { command: 'help', args: [], rawArgs: '' }
 *   parseCommand('/score 张三')      → { command: 'score', args: ['张三'], rawArgs: '张三' }
 *   parseCommand('你好')            → null
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  // 去掉前导 '/'
  const body = trimmed.slice(1).trim()
  if (body.length === 0) return { command: '', args: [], rawArgs: '' }
  // 按空白拆分:第一段是命令名(转小写,使命令大小写不敏感),其余是参数
  const spaceIdx = body.search(/\s/)
  let command: string
  let rawArgs: string
  if (spaceIdx === -1) {
    command = body
    rawArgs = ''
  } else {
    command = body.slice(0, spaceIdx)
    rawArgs = body.slice(spaceIdx + 1).trim()
  }
  const args = rawArgs.length > 0 ? rawArgs.split(/\s+/) : []
  return { command: command.toLowerCase(), args, rawArgs }
}

/**
 * 命令运行所需的能力上下文。
 * 由 feishu-bot-service 在构造时注入实现,避免本模块直接 import 主进程单例。
 */
export interface CommandContext {
  /** 执行 EAA 子命令(如 dashboard/score/ranking) */
  runEAA: (command: string, args?: string[]) => Promise<EAAResultLike>
  /** 列出可用 Agent */
  listAgents: () => Array<{ id: string; name: string; description?: string }>
  /** 用文本提示运行默认 Agent,返回完整回复文本 */
  runAgent: (prompt: string) => Promise<string>
}

/** 单个命令的处理器:接收参数 + 上下文,返回回复文本 */
type CommandHandler = (parsed: ParsedCommand, ctx: CommandContext) => Promise<string>

interface CommandEntry {
  name: string
  description: string
  handler: CommandHandler
}

/** 斜杠命令路由器 */
export class FeishuCommandRouter {
  private commands = new Map<string, CommandEntry>()

  /** 注册一个命令(命令名自动转小写) */
  register(name: string, description: string, handler: CommandHandler): this {
    this.commands.set(name.toLowerCase(), { name: name.toLowerCase(), description, handler })
    return this
  }

  /** 列出所有已注册命令(用于 /help) */
  list(): Array<{ name: string; description: string }> {
    return Array.from(this.commands.values()).map((c) => ({
      name: c.name,
      description: c.description,
    }))
  }

  /**
   * 尝试分发一段文本。
   * @returns 回复文本;若文本不是斜杠命令返回 null(调用方应转给 Agent 对话)。
   */
  async dispatch(text: string, ctx: CommandContext): Promise<string | null> {
    const parsed = parseCommand(text)
    if (!parsed) return null
    if (parsed.command === '') {
      return '请输入命令,例如 /help 查看可用命令。'
    }
    const entry = this.commands.get(parsed.command)
    if (!entry) {
      return `未知命令: /${parsed.command}\n输入 /help 查看可用命令。`
    }
    try {
      return await entry.handler(parsed, ctx)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return `命令 /${parsed.command} 执行失败: ${msg}`
    }
  }
}

// -------------------------------------------------------------
// 内置命令注册 — 直接接现有 EAA / Agent 能力,不重新造轮子。
// -------------------------------------------------------------

const TEXT_PREVIEW_LIMIT = 1800 // 飞书单条文本消息建议上限 ~4000 字符,留余量

function truncate(text: string, limit = TEXT_PREVIEW_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…(共 ${text.length} 字,已截断)`
}

function formatEAA(result: EAAResultLike): string {
  if (!result.success) {
    return `执行失败: ${getErrorMessage(result)}`
  }
  if (typeof result.data === 'string') {
    return truncate(result.data.trim()) || '(无输出)'
  }
  if (result.data !== null) {
    return truncate(JSON.stringify(result.data, null, 2))
  }
  return '(执行成功,但无输出数据)'
}

/** 注册所有内置命令,返回配置好的 router 实例 */
export function createDefaultRouter(): FeishuCommandRouter {
  const router = new FeishuCommandRouter()

  router.register('help', '查看所有可用命令', async (_p, ctx) => {
    const cmds = router.list()
    const lines = cmds.map((c) => `/${c.name} — ${c.description}`)
    const agentLines = ctx.listAgents().map((a) => `• ${a.id} (${a.name})`)
    return [
      '可用斜杠命令:',
      ...lines,
      '',
      '也可以直接发文字跟我对话,我会调用教育 Agent 回答。',
      '',
      '可用 Agent:',
      ...(agentLines.length > 0 ? agentLines : ['(暂无可用 Agent)']),
    ].join('\n')
  })

  router.register('echo', '回显你发送的内容(测试用)', async (p) => {
    return p.rawArgs || '(空)'
  })

  router.register('agents', '列出所有可用 Agent', async (_p, ctx) => {
    const agents = ctx.listAgents()
    if (agents.length === 0) return '当前没有可用的 Agent。'
    const lines = agents.map(
      (a) => `• ${a.id} — ${a.name}${a.description ? `: ${a.description}` : ''}`,
    )
    return `共 ${agents.length} 个 Agent:\n${lines.join('\n')}`
  })

  router.register('dashboard', '查看操行数据概览', async (_p, ctx) => {
    const result = await ctx.runEAA('dashboard')
    return formatEAA(result)
  })

  router.register('score', '查看某学生操行分数,用法: /score 张三', async (p, ctx) => {
    if (p.args.length === 0) return '请提供学生姓名,例如: /score 张三'
    const result = await ctx.runEAA('score', p.args)
    return formatEAA(result)
  })

  router.register('ranking', '查看操行排行榜', async (_p, ctx) => {
    const result = await ctx.runEAA('ranking')
    return formatEAA(result)
  })

  router.register('stats', '查看操行统计数据', async (_p, ctx) => {
    const result = await ctx.runEAA('stats')
    return formatEAA(result)
  })

  router.register('list', '列出所有学生', async (_p, ctx) => {
    const result = await ctx.runEAA('list-students')
    return formatEAA(result)
  })

  return router
}
