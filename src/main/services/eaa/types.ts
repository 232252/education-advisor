// =============================================================
// EAA Bridge — 类型定义与统一返回结构
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

export interface EAACommand {
  command: string
  args: string[]
  timeout?: number
  /** 显式指定是否需要 JSON 输出；不指定则按命令名自动判断 */
  jsonOutput?: boolean
  /** 强制跳过读缓存、重新 spawn 拉取（用于「刷新」按钮） */
  forceRefresh?: boolean
}

/**
 * EAAResult — 统一返回结构
 * JSON 命令：data 为解析后的对象
 * 文本命令：data 为原始字符串
 */
export interface EAAResult<T = unknown> {
  success: boolean
  data: T | null
  stderr: string
  exitCode: number
}

/**
 * 从 EAAResult 中提取最有用的错误信息。
 * TEXT_OUTPUT_COMMANDS 失败时 CLI 的详细错误在 data（字符串）里，
 * JSON 命令失败时在 stderr 里。此函数按优先级选取。
 */
export function getErrorMessage(result: EAAResult, fallback = '未知错误'): string {
  if (typeof result.data === 'string' && result.data.length > 0) return result.data
  if (result.stderr && result.stderr.length > 0) return result.stderr
  return fallback
}

/**
 * EAA CLI export 命令支持的导出格式（静态降级列表）。
 * 与 Rust 源码 core/eaa-cli/src/commands.rs 的 cmd_export() 同步：
 *   Rust 仅支持 csv / jsonl / html 三种格式。
 * 当 EAA 二进制可用时，getSupportedExportFormats() 会动态探测实际支持的格式，
 * 此常量仅作为二进制不可用或探测失败时的降级。
 */
export const SUPPORTED_EXPORT_FORMATS = ['csv', 'jsonl', 'html'] as const
export type ExportFormat = (typeof SUPPORTED_EXPORT_FORMATS)[number]
