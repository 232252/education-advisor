// =============================================================
// DSH 内置斜杠指令 — 静态目录 + 输入解析（纯函数，可单测）
//
// 为什么是静态清单：DSH SDK 没有「列举指令」的 wire 方法（指令目录靠
// commands/change 事件 + Agent catalog，客户端拿不到现成清单）。因此教师端
// 内置 DSH 六个官方指令的中英拼写，对照 @deepseek-ai/dsh-commands/builtin。
// 执行仍走 DSH 原生 session/query 路由，本模块只负责「识别 + 菜单」，不替代
// DSH 的指令解析。升级 DSH 时若内置指令增减，由守卫测试对照真实包提示漂移。
//
// 放 shared：主进程（门面识别）与渲染端（输入菜单）共用同一份目录。
// =============================================================

export interface SlashCommand {
  /** 英文指令名（小写、无前导斜杠），与 DSH builtinCommandTokens.en 一致 */
  name: string
  /** 中文拼写，与 DSH builtinCommandTokens.zh 一致 */
  zh: string
  /** 面向教师的一句话说明（菜单展示用） */
  description: string
}

/** DSH 六个内置指令（goal/plan/feedback/compact/permission/export）。 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'goal', zh: '目标', description: '设定本轮目标，模型围绕目标推进并自动多轮' },
  { name: 'plan', zh: '计划', description: '先出计划供你评审，确认后再执行' },
  { name: 'feedback', zh: '反馈', description: '就上一轮结果给出反馈，让模型据此调整' },
  { name: 'compact', zh: '压缩', description: '压缩当前会话上下文，长对话省 token' },
  { name: 'permission', zh: '权限', description: '查看/调整本会话的工具权限预设' },
  { name: 'export', zh: '导出', description: '导出本会话日志' },
]

/** 去掉首尾空白与前导斜杠，得到查询 token（小写用于英文匹配）。 */
function queryToken(query: string): string {
  return query.trim().replace(/^\//, '')
}

/** 是否构成指令输入：以 / 开头且斜杠后有非空指令名。 */
export function isSlashInput(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('/')) return false
  const name = t.slice(1).split(/\s/)[0]
  return name.length > 0
}

/**
 * 拆出指令名与参数。仅用于 UI 识别/菜单，不做 wire 解析——
 * 真正执行时把原始整行交给 DSH session/query，由 DSH 自己 parseCommand。
 * 非指令输入返回 null。
 */
export function parseSlashInput(text: string): { name: string; args: string } | null {
  const t = text.trim()
  if (!t.startsWith('/')) return null
  const m = t.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  return { name: m[1], args: (m[2] ?? '').trim() }
}

/** 菜单过滤：空查询返回全部；否则按英文名前缀或中文拼写前缀匹配。 */
export function matchSlashCommands(query: string): SlashCommand[] {
  const token = queryToken(query)
  if (!token) return [...SLASH_COMMANDS]
  const lower = token.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(lower) || c.zh.startsWith(token))
}
