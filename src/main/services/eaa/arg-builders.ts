// =============================================================
// EAA add 命令参数组装(services 层权威实现)
// buildAddEventArgs 从 ipc/eaa/commands.ts 移入:Agent 工具(addEventTool)
// 与 IPC handler 必须共用同一份组装逻辑,否则 tags 分隔符 / delta 默认值
// 会出现行为漂移(Rust 端按 ';' split tags,缺省 delta 从 reason-codes 查默认值)。
// sanitize 失败时直接抛错,由调用方 catch/包装。
// =============================================================

import type { AddEventParams } from '@shared/types'
import { sanitizeFreeText, sanitizeName } from '../../utils/sanitize'
import { lookupReasonCodeDelta } from './reason-codes'

/** 组装 add 命令参数(含 delta 默认值查找与 sanitize)。sanitize 失败时直接抛错,由调用方 catch。 */
export function buildAddEventArgs(params: AddEventParams): string[] {
  const safeName = sanitizeName(params.studentName, 'studentName')
  const safeCode = sanitizeName(params.reasonCode, 'reasonCode')
  const args: string[] = [safeName, safeCode]
  // delta 未提供时,自动从 reason-codes.json 查找默认值
  // 避免 EAA 二进制默认 0.0 导致校验失败
  const delta = params.delta ?? lookupReasonCodeDelta(params.reasonCode)
  if (delta !== undefined) args.push('--delta', String(delta))
  // 修复: note/reason 用 sanitizeFreeText(允许 / \ . () 等正常文本)
  // 此前用 sanitizeName 会拒绝 "迟到/早退" 等正常 note 文本
  if (params.note) args.push('--note', sanitizeFreeText(params.note, 'note', 500))
  if (params.operator) args.push('--operator', sanitizeName(params.operator, 'operator'))
  if (params.dryRun) args.push('--dry-run')
  if (params.force) args.push('--force')
  if (params.tags?.length)
    // v3.2.7 fix BUG#3: 与 EAA CLI v3.2.5+ 对齐,tags 分隔符从逗号改为分号
    // (Rust 端 commands.rs cmd_add 用 split(';') 解析,允许 tag 内含逗号)
    args.push('--tags', params.tags.map((t) => sanitizeName(t, 'tag')).join(';'))
  return args
}
