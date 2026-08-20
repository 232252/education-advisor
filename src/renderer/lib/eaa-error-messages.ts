// =============================================================
// EAA 错误消息翻译层 — D9 错误可观测性
// 将 EAA 引擎(Rust AppError)与 bridge 层的英文错误系统性翻译为
// 当前语言的用户可读提示。接入唯一错误展示漏斗 getErrorMessage(),
// 渲染层全部展示点(toast/状态行)自动受益。
// 已是中文的消息(CLI 校验类)与未知消息原样透传,不做猜测。
// =============================================================

import { t } from '../i18n'

interface ErrorPattern {
  /** 匹配原始消息的正则,捕获组 1 为细节(可选) */
  pattern: RegExp
  /** i18n 键,值中含 {0} 占位符用于填充细节 */
  key: string
}

/** Rust AppError(core/eaa-cli/src/types.rs)与 bridge 层已知错误模式 → i18n 键 */
const PATTERNS: ErrorPattern[] = [
  { pattern: /^Student not found:\s*(.+)$/s, key: 'error.eaa.studentNotFound' },
  { pattern: /^Event not found:\s*(.+)$/s, key: 'error.eaa.eventNotFound' },
  { pattern: /^Validation failed:\s*(.+)$/s, key: 'error.eaa.validationFailed' },
  { pattern: /^IO error:\s*(.+)$/s, key: 'error.eaa.ioError' },
  { pattern: /^JSON error:\s*(.+)$/s, key: 'error.eaa.jsonError' },
  // eaa/platform.ts: 二进制缺失(面向开发者的提示翻译为面向用户的指引)
  { pattern: /EAA binary not (?:found|available)/, key: 'error.eaa.binaryMissing' },
  // eaa/output-parser.ts: 退出码 0 但 stdout 为空的可重试失败标记
  { pattern: /\[EAA_EMPTY_STDOUT\]/, key: 'error.eaa.emptyOutput' },
  // eaa/process-executor.ts: 用户中止
  { pattern: /^aborted$/, key: 'error.eaa.aborted' },
]

/** CLI 顶层错误输出前缀(main.rs eprintln!("错误: {}", e)),匹配前先剥离 */
const ERROR_PREFIX = /^(?:错误|Error)[:：]\s*/

/**
 * 尝试将 EAA 错误消息翻译为当前语言的用户可读提示。
 * - 命中已知模式 → 返回 i18n 翻译(细节填入 {0})
 * - 未命中(含已是中文的消息)→ 返回 null,由调用方原样展示
 */
export function translateEaaError(message: string): string | null {
  const trimmed = message.trim().replace(ERROR_PREFIX, '').trim()
  if (!trimmed) return null
  for (const { pattern, key } of PATTERNS) {
    const m = trimmed.match(pattern)
    if (m) {
      const detail = (m[1] ?? '').trim()
      const text = t(key, trimmed)
      return detail ? text.replace('{0}', detail) : text
    }
  }
  return null
}
