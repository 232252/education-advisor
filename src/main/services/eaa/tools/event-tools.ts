// =============================================================
// EAA Tools — 事件操作类工具(add_event / revert_event)
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import { Type } from 'typebox'
import { buildAddEventArgs } from '../arg-builders'
import { executeWithSignal, safeExecute } from './sanitize'
import { assertEaaSuccess, extractData, textResult } from './shared'

// =============================================================
// Schema 定义
// =============================================================

const addEventParams = Type.Object({
  student_name: Type.String({ description: '学生姓名' }),
  reason_code: Type.String({
    description:
      '原因码(如 LATE, CLASS_MONITOR)。必须取自 eaa_codes 工具的查询结果 — 不确定时先调 eaa_codes,凭记忆猜码会报错',
  }),
  delta: Type.Optional(
    Type.Number({ description: '分数变动（-10 到 +10），如果原因码有固定分值可不填' }),
  ),
  note: Type.Optional(Type.String({ description: '备注说明' })),
  tags: Type.Optional(Type.String({ description: '标签，分号分隔（如 期中;表扬）' })),
  force: Type.Optional(
    Type.Boolean({
      description:
        '超出常规分值范围（如 |delta|>10）时强制写入。仅在用户明确要求时使用，普通加减分不要传',
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: '只校验不真正写入（预演）。适合不确定原因码/分值是否正确时先验证一遍',
    }),
  ),
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
      force: params.force,
      dryRun: params.dry_run,
      tags: params.tags
        ? params.tags
            .split(';')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    })
    const result = await executeWithSignal({ command: 'add', args }, signal)
    assertEaaSuccess(result, '添加事件失败')
    // R2+(文案修复): dry_run 预演必须明说"未写入" — 此前统一返回
    // "事件已添加",模型会据此告知用户"已记录"而实际什么都没落库
    return textResult(
      params.dry_run
        ? `[dry-run 预演,未写入数据] ${extractData(result.data)} — 若确认无误,请向教师复述并再次调用(dry_run:false)正式写入`
        : `事件已添加: ${extractData(result.data)}`,
    )
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
    assertEaaSuccess(result, '撤销事件失败')
    return textResult(`事件 ${params.event_id} 已撤销 (原因: ${params.reason})`)
  },
}
