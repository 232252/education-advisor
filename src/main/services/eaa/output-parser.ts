// =============================================================
// EAA Bridge — 输出解析
// stdout JSON 提取 / 空输出错误归一化 / export --help 格式解析
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { EAAResult } from './types'
import { SUPPORTED_EXPORT_FORMATS } from './types'

/**
 * 解析子进程输出为 EAAResult(提取自 EAABridge._doExecute 的 close 处理,逻辑逐字保留)。
 * @param expectsJson 是否追加了 --output json(仅此时尝试 JSON.parse)
 */
export function parseProcessOutput<T>(
  stdout: string,
  stderr: string,
  exitCode: number,
  expectsJson: boolean,
): EAAResult<T> {
  const success = exitCode === 0

  // 解析 stdout：仅当追加了 --output json 时尝试 JSON.parse
  if (expectsJson) {
    // P1-9 修复: 并发文件锁竞争时 eaa 二进制可能退出码 0 但 stdout 为空。
    // 此时 JSON.parse('') 抛错, 旧逻辑把 success 保持为 true 并返回 data: null,
    // 导致上层工具误判为"成功但无数据"。这里把"空 stdout + 退出码 0"标记为可重试失败,
    // 用 stderr 携带 EAA_EMPTY_STDOUT 标记, execute() 会据此触发重试。
    // 注: 仅在 exitCode === 0 时标记, exitCode != 0 的失败已正确反映无需重试。
    if (success && stdout.trim() === '') {
      const retryHint = stderr.trim() ? `${stderr}\n[EAA_EMPTY_STDOUT]` : '[EAA_EMPTY_STDOUT]'
      return { success: false, data: null, stderr: retryHint, exitCode }
    }
    try {
      const value = JSON.parse(stdout) as T
      return { success, data: value, stderr, exitCode }
    } catch {
      // JSON 解析失败：data 设为 null
      return { success, data: null, stderr, exitCode }
    }
  }

  // 非 JSON 命令：直接返回原始文本作为 data
  return {
    success,
    data: (stdout.trim() || stderr.trim()) as T | null,
    stderr,
    exitCode,
  }
}

/**
 * 从 `eaa export --help` 输出中解析支持的格式。
 * 帮助文本通常包含类似 "导出格式: csv(默认), jsonl, html" 的描述。
 *
 * R29-2 修复: 之前 knownFormats 包含 'json', 但 EAA Rust 二进制实际不支持 json 导出
 * (cmd_export 只支持 csv/jsonl/html)。帮助文本中可能出现 "JSON" 字样(如描述 jsonl 时),
 * 导致误判。现在只检测静态列表中已确认支持的格式, 避免误报。
 */
export function parseExportFormatsFromHelp(helpText: string): string[] {
  const found: string[] = []

  // 只检测静态列表中已确认支持的格式, 不猜测新格式
  for (const fmt of SUPPORTED_EXPORT_FORMATS) {
    // 使用 word boundary 确保不匹配子串（如 "csv" 不匹配 "csvfile"）
    const regex = new RegExp(`\\b${fmt}\\b`, 'i')
    if (regex.test(helpText)) {
      found.push(fmt)
    }
  }

  // 确保至少包含静态列表中的格式（以防帮助文本格式变化）
  for (const fmt of SUPPORTED_EXPORT_FORMATS) {
    if (!found.includes(fmt)) found.push(fmt)
  }

  return found
}
