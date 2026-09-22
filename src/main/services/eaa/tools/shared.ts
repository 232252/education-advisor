// =============================================================
// EAA Tools — 共享辅助: 结果构造与公共参数 schema
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentToolResult } from '@main/services/llm-contracts'
import { Type } from 'typebox'
// 注意: getErrorMessage 从 eaa/types(纯函数)导入而非 eaa-bridge —
// shared.ts 被 utility-tools 等纯逻辑单测引用,不得把 electron 依赖链拉进来
import { type EAAResult, getErrorMessage } from '../../eaa/types'

// 辅助函数：构造 TextContent 结果
export function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

export function jsonResult(data: unknown, summary: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    details: { summary },
  }
}

/**
 * 断言 EAA 调用成功,失败时抛出带中文上下文标签的错误。
 * 统一 `throw new Error(`${label}: ${getErrorMessage(result)}`)` 形态
 * (全部工具文件的失败分支共用)。
 */
export function assertEaaSuccess(result: EAAResult, label: string): void {
  if (!result.success) {
    throw new Error(`${label}: ${getErrorMessage(result)}`)
  }
}

/**
 * CLI 返回 {total, showing, events}: total > showing 说明被 limit 截断,
 * 必须显式告知模型,否则模型会基于残缺数据下"共 N 起"类统计结论。
 * 检测到截断时在结果上附加 events_truncated 标注( hint 为各工具的自纠提示)。
 */
export function withTruncationNotice<T extends { total?: number; showing?: number }>(
  data: T,
  summary: string,
  hint: string,
): AgentToolResult<unknown> {
  if (
    typeof data.total === 'number' &&
    typeof data.showing === 'number' &&
    data.total > data.showing
  ) {
    return jsonResult(
      {
        ...data,
        events_truncated: `仅返回前 ${data.showing}/${data.total} 条(受 limit 限制),${hint}`,
      },
      summary,
    )
  }
  return jsonResult(data, summary)
}

/**
 * 从 EAAResult.data 中提取值：
 * JSON 命令返回的对象直接使用；
 * null 时返回 fallback 文本
 */
export function extractData<T = unknown>(data: T | null, fallback = '(无数据)'): T | string {
  return data ?? fallback
}

// =============================================================
// 公共参数 schema(多个工具文件共用)
// =============================================================

export const nameParam = Type.Object({
  name: Type.String({ description: '学生姓名' }),
})

export const emptyParams = Type.Object({})
