// =============================================================
// escalate_to_main 工具 — 安全类 Agent 的紧急上报通道
//
// 背景: psychology/risk-alert 等 SOUL 里写了"高危 → 立即通知 main Agent /
// 推送给班主任",但此前 delegate_to 只有 main 持有且方向相反,
// 专家 Agent 之间以及专家 → main 的通知链完全不存在。
//
// 设计(与 delegate_to 的差异):
//   - 方向相反: 专家 Agent → main(以及可选的飞书即时推送)
//   - fire-and-forget: 上报入队后立即返回确认,不在工具调用内等待
//     main 完成(避免长阻塞与超时误杀;main 的运行走自己的串行队列)
//   - 门控: 仅显式声明 'escalate' capability 的 agent 获得(见 agents.yaml:
//     psychology / risk-alert / safety)
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { textResult } from '../eaa/tools/shared'

/** 拥有 escalate_to_main 的能力标记(在 agents.yaml capabilities 中声明) */
export const ESCALATE_CAPABILITY = 'escalate'

export const escalateParams = Type.Object({
  severity: Type.String({
    description: '严重程度: critical(危及安全,需立即处理) / warning(需要尽快关注) / info(同步信息)',
  }),
  summary: Type.String({
    description: '紧急情况一句话摘要(如"张三出现高危心理信号,建议今日内面谈")',
  }),
  detail: Type.Optional(Type.String({ description: '补充细节: 观察依据、涉及学生、建议措施等' })),
})

/** 由 AgentService 注入的上报动作(单向依赖,避免循环引用) */
export interface EscalationToolDeps {
  /**
   * 把上报文本排入 main 的运行队列(fire-and-forget 语义: 入队即算成功,
   * 返回 false 表示入队失败如队列已满)。
   */
  enqueueMainReport(text: string): Promise<boolean>
  /** 可选: 飞书即时推送(未配置时由实现方返回 skipped) */
  sendFeishuAlert?(text: string): Promise<{ success: boolean; skipped?: string; error?: string }>
}

export function createEscalateToMainTool(
  deps: EscalationToolDeps,
  context: { sourceAgentId: string },
): AgentTool<typeof escalateParams> {
  return {
    name: 'escalate_to_main',
    label: '紧急上报',
    description:
      '把你发现的需要教师立即关注的情况(心理危机信号、安全风险、高风险学生异动等)上报给主协调 Agent 并推送给班主任。用于紧急/重要事项的主动上报,不要用于常规查询结果汇报。',
    parameters: escalateParams,
    execute: async (_toolCallId, params) => {
      const severity = ['critical', 'warning', 'info'].includes(params.severity)
        ? params.severity
        : 'warning'
      const reportText =
        `[紧急上报][${severity}] 来自 ${context.sourceAgentId}:\n${params.summary}` +
        (params.detail ? `\n详情: ${params.detail}` : '')

      const lines: string[] = []
      try {
        const queued = await deps.enqueueMainReport(reportText)
        lines.push(
          queued
            ? '已上报给主协调 Agent(main 将汇总处理并在界面呈现)。'
            : '上报 main 失败(队列已满或 main 不可用),请直接在回复中向用户说明情况。',
        )
      } catch (err) {
        lines.push(
          `上报 main 失败: ${err instanceof Error ? err.message : String(err)} — 请直接在回复中向用户说明情况。`,
        )
      }

      if (deps.sendFeishuAlert) {
        try {
          const push = await deps.sendFeishuAlert(reportText)
          if (push.skipped) {
            lines.push(`飞书推送跳过(${push.skipped})。`)
          } else if (push.success) {
            lines.push('已通过飞书推送给班主任。')
          } else {
            lines.push(`飞书推送失败: ${push.error ?? '未知错误'}。`)
          }
        } catch (err) {
          lines.push(`飞书推送异常: ${err instanceof Error ? err.message : String(err)}。`)
        }
      }

      if (severity === 'critical') {
        lines.push('注意: 这是 critical 级上报 — 请在本次回复中同时向用户醒目地重复该紧急情况。')
      }
      return textResult(lines.join('\n'))
    },
  }
}
