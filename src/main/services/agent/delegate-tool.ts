// =============================================================
// M32: delegate_to 轻量路由工具 — main 委托专家 Agent
// (规格见 docs/review/03-修改指南.md M32)
//
// 设计流:
//   main 调 delegate_to(target='academic', task='分析张三近三次数学成绩趋势')
//   → 主进程 enqueue academic 的 runQueue(复用现有队列与状态推送)
//   → academic 执行完成后,结果作为 tool_result 回传给 main 的下一轮
//   → main 汇总输出给用户
//
// 边界(防递归风暴):
//   1. 工具只注入 main 一个角色(agent/tools.ts 按 DELEGATE_SOURCE_AGENT_ID
//      门控,其他角色不获得该工具)
//   2. 目标不能是委托发起方自身 — main 的串行队列 tail 正被当前运行占用,
//      自委托会形成"当前运行等工具结果 vs 排队任务等当前运行"的循环等待
//   3. 嵌套委托显式拒绝 — 已核实 runQueue 的 maxDepth 只限制单 agent 排队
//      长度,拦不住"委托任务内再委托"的递归链,故按规格在工具执行处
//      检查"当前已在委托执行中则拒绝"
//
// 超时沿用 agent 级超时(委托运行走 executeAgentRun,waitForIdle 超时
// 对其同样生效);abort 传播:main 被 abort 时经工具 signal 尽量取消委托任务
// (pi-agent-core 把 agent 内部 run 的 AbortSignal 作为第 3 参传给 execute)。
// =============================================================

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentExecution } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { Type } from 'typebox'
import { textResult } from '../eaa/tools/shared'

/** delegate_to 唯一注入的协调者角色(其他角色不获得该工具,防递归风暴) */
export const DELEGATE_SOURCE_AGENT_ID = 'main'

// =============================================================
// Schema
// =============================================================

const delegateToParams = Type.Object({
  target_agent_id: Type.String({
    description:
      '目标专家 Agent 的 id(如 academic、psychology、counselor)。不能是 main 自身;可用 id 以系统提供的 Agent 列表为准。',
  }),
  task: Type.String({
    description:
      '委托给目标 Agent 的完整任务描述,需自包含背景信息(如"分析张三近三次数学成绩趋势,给出结论与建议"),目标 Agent 只能看到这段文本。',
  }),
})

// =============================================================
// 依赖契约(由 AgentService 注入,单向依赖避免与 agent-service 循环引用)
// =============================================================

export interface DelegateToolDeps {
  /** 校验目标 agent 可委托性: 返回 null 表示可委托,否则返回错误信息(不存在/已停用) */
  validateTarget(targetAgentId: string): string | null
  /** 是否已有委托任务在途(嵌套/并行委托拦截) */
  isDelegationInProgress(): boolean
  /** enqueue 目标 agent 的 runQueue 并等待完成(复用现有队列/状态推送/agent 级超时) */
  runDelegatedTask(
    targetAgentId: string,
    task: string,
    win?: BrowserWindow,
  ): Promise<AgentExecution | undefined>
  /** abort 传播: 委托发起方被中止时取消目标 agent 的运行/排队任务 */
  abortDelegatedAgent(targetAgentId: string, win?: BrowserWindow): Promise<boolean>
}

// =============================================================
// abort 传播辅助
// =============================================================

/**
 * 等待委托 promise;signal 中止时触发 onAbort(尽量取消委托任务)并立即返回 undefined。
 * onAbort 失败不阻塞工具返回(此时目标 agent 依赖自身超时兜底)。
 */
function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => unknown,
): Promise<T | undefined> {
  if (!signal) return promise
  if (signal.aborted) {
    void Promise.resolve(onAbort()).catch(() => {})
    return Promise.resolve(undefined)
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbortEvent)
    const onAbortEvent = () => {
      cleanup()
      void Promise.resolve(onAbort()).catch(() => {})
      resolve(undefined)
    }
    signal.addEventListener('abort', onAbortEvent, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      },
    )
  })
}

// =============================================================
// 工具工厂
// =============================================================

/**
 * 创建 delegate_to 工具实例。
 * 每次 main 运行时随 buildAgentTools 重建,context 捕获当次运行的 sourceAgentId/win。
 */
export function createDelegateToTool(
  deps: DelegateToolDeps,
  context: { sourceAgentId: string; win?: BrowserWindow },
): AgentTool<typeof delegateToParams> {
  return {
    name: 'delegate_to',
    label: '委托专家 Agent',
    description:
      '把任务委托给对应领域的专家 Agent 执行,等待其完成后把结果作为依据返回(适合需要专业深度分析、而直接调用查询工具难以覆盖的场景)。只能委托给其他专家 Agent,不能委托给 main 自身;同一时刻只允许一个在途委托。',
    parameters: delegateToParams,
    execute: async (_toolCallId, params, signal) => {
      const targetId = params.target_agent_id
      const task = params.task

      // 边界 2: 自委托 → 串行队列循环等待(会 hang 到 agent 超时),必须拒绝
      if (targetId === context.sourceAgentId) {
        return textResult(
          `[delegate_to 拒绝] 不能委托给 ${context.sourceAgentId} 自身:当前运行正在等待本工具返回,` +
            '自委托任务会在串行队列上等待当前运行完成,形成循环等待。请直接完成任务,或委托给其他专家 Agent。',
        )
      }
      // 边界 3: 嵌套/并行委托拦截(runQueue 深度上限只限排队长度,拦不住递归委托链)
      if (deps.isDelegationInProgress()) {
        return textResult(
          '[delegate_to 拒绝] 当前已有委托任务在执行中,不支持嵌套/并行委托(防递归风暴)。' +
            '请等待当前委托返回后基于其结果继续;如需多次委托,逐个串行发起。',
        )
      }
      // 目标存在性/启用校验(错误作为 tool_result 返回,main 可向用户如实转述)
      const validationError = deps.validateTarget(targetId)
      if (validationError) {
        return textResult(`[delegate_to 错误] ${validationError}`)
      }

      console.log(
        `[AgentService] delegate_to: ${context.sourceAgentId} → ${targetId} (task: ${task.length > 80 ? `${task.slice(0, 80)}...` : task})`,
      )
      try {
        const execution = await awaitWithAbort(
          deps.runDelegatedTask(targetId, task, context.win),
          signal,
          () => deps.abortDelegatedAgent(targetId, context.win),
        )
        // undefined: 排队期间被 abort 放弃执行,或 main 被 abort 后取消了委托
        if (!execution) {
          return textResult(
            `[delegate_to] 目标 Agent ${targetId} 的执行被取消(委托发起方的运行已中止或任务被放弃),无结果返回。`,
          )
        }
        if (execution.status === 'timeout') {
          return textResult(
            `[delegate_to] 目标 Agent ${targetId} 执行超时:\n${execution.output || '(无输出)'}`,
          )
        }
        if (execution.status !== 'success') {
          return textResult(
            `[delegate_to] 目标 Agent ${targetId} 执行失败:\n${execution.output || '(无输出)'}`,
          )
        }
        return textResult(
          `[delegate_to] ${targetId} 的执行结果(耗时 ${(execution.durationMs / 1000).toFixed(1)}s):\n${execution.output || '(无输出)'}`,
        )
      } catch (err) {
        // runAgent 同步抛错(如目标排队已满)— 如实返回给 main
        const msg = err instanceof Error ? err.message : String(err)
        return textResult(`[delegate_to 错误] 委托 ${targetId} 失败: ${msg}`)
      }
    },
  }
}
