// =============================================================
// EAA Tools — 事件操作类工具(add_event / revert_event)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { eaaBridge, getErrorMessage } from '../../eaa-bridge'
import { buildAddEventArgs } from '../arg-builders'
import { safeExecute } from './sanitize'
import { extractData, textResult } from './shared'

// =============================================================
// Schema 定义
// =============================================================

const addEventParams = Type.Object({
  student_name: Type.String({ description: '学生姓名' }),
  reason_code: Type.String({
    description: '原因码（必须存在于 reason_codes.json 中，如 LATE, CLASS_MONITOR 等）',
  }),
  delta: Type.Optional(
    Type.Number({ description: '分数变动（-10 到 +10），如果原因码有固定分值可不填' }),
  ),
  note: Type.Optional(Type.String({ description: '备注说明' })),
  tags: Type.Optional(Type.String({ description: '标签，分号分隔（如 期中;表扬）' })),
})

const revertEventParams = Type.Object({
  event_id: Type.String({
    description: '要撤销的事件 ID（可从 eaa_history / eaa_search 结果获取）',
  }),
  reason: Type.String({ description: '撤销原因（简短说明）' }),
})

// =============================================================
// 2. 添加操行事件
// =============================================================
export const addEventTool: AgentTool<typeof addEventParams> = {
  name: 'eaa_add_event',
  label: '添加操行事件',
  description: '为指定学生添加一条操行事件（加分或扣分）',
  parameters: addEventParams,
  execute: async (_toolCallId, params, signal) => {
    // 统一走 buildAddEventArgs(与 IPC eaa:add-event 同一份组装逻辑):
    // tags 用 ';' 连接(Rust 端 split(';') 解析)、delta 缺省从 reason-codes 查默认值。
    // args 已在组装内部 sanitize,不再过 safeExecute 的 sanitizeArg(会拒绝 -- flag)。
    const args = buildAddEventArgs({
      studentName: params.student_name,
      reasonCode: params.reason_code,
      delta: params.delta,
      note: params.note,
      tags: params.tags
        ? params.tags
            .split(';')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    })
    const cmd = { command: 'add' as const, args }
    // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约)
    const result = await (signal ? eaaBridge.execute(cmd, { signal }) : eaaBridge.execute(cmd))
    if (!result.success) {
      throw new Error(`添加事件失败: ${getErrorMessage(result)}`)
    }
    return textResult(`事件已添加: ${extractData(result.data)}`)
  },
}

// =============================================================
// 13. 撤销操行事件 — 对应 eaa:revert-event (GAP-1 补全)
// =============================================================
export const revertEventTool: AgentTool<typeof revertEventParams> = {
  name: 'eaa_revert_event',
  label: '撤销操行事件',
  description:
    '撤销一条已存在的操行事件（加分/扣分），需提供事件 ID 和撤销原因。会回退该事件对分数的影响',
  parameters: revertEventParams,
  execute: async (_toolCallId, params, signal) => {
    const result = await safeExecute(
      'revert',
      [params.event_id, '--reason', params.reason],
      [],
      signal,
    )
    if (!result.success) {
      throw new Error(`撤销事件失败: ${getErrorMessage(result)}`)
    }
    return textResult(`事件 ${params.event_id} 已撤销 (原因: ${params.reason})`)
  },
}
