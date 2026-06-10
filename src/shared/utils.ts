/**
 * 共享工具 — 主进程和渲染进程都可安全导入
 * (B-22/B-24 抽取: 消除 eaa-bridge.ts / ipc-client.ts / eaa-handlers.ts / eaa-tools.ts 的重复)
 */

export interface EAAResultLike<T = unknown> {
  success: boolean
  data: T | null
  stderr: string
  exitCode: number
  requiresConfirmation?: boolean
}

/**
 * 从 EAAResult 提取最有用的错误信息
 * B-22: 主进程 + 渲染进程统一从 shared 引入
 */
export function getErrorMessage(result: EAAResultLike, fallback = 'Unknown error'): string {
  if (typeof result.data === 'string' && result.data.length > 0) return result.data
  if (result.stderr && result.stderr.length > 0) return result.stderr
  return fallback
}

/**
 * 将查询字符串拆成 token, 保留引号内的空格
 * B-24: 主进程 eaa-handlers.ts / eaa-tools.ts 都从 shared 引入
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (/\s/.test(ch) && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}
