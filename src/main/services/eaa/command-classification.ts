// =============================================================
// EAA Bridge — 命令分类
// 命令名 → JSON/文本输出类型、写命令集合、参数脱敏与 args 构建
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { EAACommand } from './types'

/** 已知会产生 JSON 输出的命令（其余命令如 add/revert/export/dashboard 等为文本输出） */
export const JSON_COMPATIBLE_COMMANDS = new Set<string>([
  'doctor',
  'list',
  'get',
  'query',
  'search',
  'stats',
  'report',
  'find',
  'show',
  'status',
  'history',
  'summary',
  'ranking',
  'info',
  'score',
  'validate',
  'range',
  'tag',
  'codes',
  'list-students',
  'replay',
])

/** 已知会产生文本/文件输出的命令（不追加 --output json） */
export const TEXT_OUTPUT_COMMANDS = new Set<string>([
  'export', // 输出 CSV/JSONL/HTML 文件
  'dashboard', // 生成 HTML 文件
  'serve', // 启动 HTTP 服务
  'init', // 初始化
  'config', // 配置
  'privacy', // 隐私子命令（嵌套命令有自己的输出格式）
  'add',
  'revert',
  'add-student',
  'delete-student',
  'set-student-meta',
  'import',
])

/** 所有其他命令均视为 JSON 兼容命令，自动追加 --output json */

/**
 * RISK 7 修复: 需要串行化的写命令集合(基于 TEXT_OUTPUT_COMMANDS 中会修改数据的命令)。
 * doctor/list/get/query 等读命令不在此集合中,可并发执行。
 */
export const WRITE_COMMANDS = new Set<string>([
  'add',
  'add-student',
  'delete-student',
  'set-student-meta',
  'revert',
  'import',
  'init',
  'config',
  'privacy',
])

/**
 * High 修复: 对包含敏感信息(密码)的命令参数做脱敏,避免泄露到日志文件。
 * privacy init/load/disable 命令的位置参数 0/1 是明文密码,需要替换为 ***。
 * 纯函数,不依赖实例状态,方便单测。
 *
 * @param command EAA 命令名(如 'privacy')
 * @param args 参数数组
 * @param includesCommand args[0] 是否是命令名(即 args 结构为 ['privacy', 'init', 'password'])
 *                        false: args 结构为 ['init', 'password'](cmd.args)
 *                        true:  args 结构为 ['privacy', 'init', 'password'](full args)
 */
export function sanitizeArgsForLog(
  command: string,
  args: readonly string[],
  includesCommand = false,
): string[] {
  if (command !== 'privacy') return [...args]
  // privacy 子命令结构:
  //   includesCommand=false: [subcommand, ...args]  (cmd.args)
  //   includesCommand=true:  [command, subcommand, ...args]  (full args)
  const sub = includesCommand ? args[1] : args[0]
  const PASSWORD_CMDS = new Set(['init', 'load', 'disable'])
  if (!PASSWORD_CMDS.has(sub)) return [...args]
  if (includesCommand) {
    // full args: ['privacy', 'init', 'password', ...] → ['privacy', 'init', '***', ...]
    if (args.length >= 3) {
      return [args[0], args[1], '***', ...args.slice(3)]
    }
  } else {
    // cmd.args: ['init', 'password', ...] → ['init', '***', ...]
    if (args.length >= 2) {
      return [args[0], '***', ...args.slice(2)]
    }
  }
  return [...args]
}

/**
 * 根据命令分类构建传给 eaa 二进制的完整参数数组
 * (决定是否追加 --output json;提取自 EAABridge._doExecute,逻辑逐字保留)。
 */
export function buildCommandArgs(cmd: EAACommand): string[] {
  // 根据命令名决定是否追加 --output json
  let args: string[]
  if (cmd.jsonOutput === true) {
    args = [cmd.command, ...cmd.args, '--output', 'json']
  } else if (cmd.jsonOutput === false) {
    args = [cmd.command, ...cmd.args]
  } else if (JSON_COMPATIBLE_COMMANDS.has(cmd.command)) {
    args = [cmd.command, ...cmd.args, '--output', 'json']
  } else if (TEXT_OUTPUT_COMMANDS.has(cmd.command)) {
    args = [cmd.command, ...cmd.args]
  } else {
    // 未知命令：默认追加 --output json（所有 EAA 命令都支持全局 -O/--output 选项）
    args = [cmd.command, ...cmd.args, '--output', 'json']
  }
  return args
}
