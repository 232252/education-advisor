// =============================================================
// Agent 智能续跑 — 过早结束检测 + 续跑循环策略
// (M16 从 execution.ts 拆出,循环逻辑与日志逐字保留;
//   isNonRetryableError 为纯函数,续跑决策表可直接单测)
// =============================================================

import { matchesAnyKeyword, NON_RETRYABLE_KEYWORDS } from '../../utils/retry-keywords'
import { MAX_CONTINUATIONS, MIN_OUTPUT_CHARS, MIN_TURN_COUNT } from '../agent-model-selector'

/**
 * 不可重试错误判定: 429/401/403/rate_limit/quota 等鉴权或配额类错误。
 * 命中时跳过续跑,避免对已限流/鉴权失败的账户继续发起无意义的 API 调用。
 */
export function isNonRetryableError(errMsg: string): boolean {
  return matchesAnyKeyword(errMsg.toLowerCase(), NON_RETRYABLE_KEYWORDS)
}

/** 续跑循环依赖(最小接口,便于单测注入 fake) */
interface ContinuationDeps {
  /** agent id(日志) */
  id: string
  /** 续跑 prompt 发送目标 */
  prompt: (text: string) => Promise<unknown>
  /** waitForIdle 的超时包装 */
  waitIdle: (label: string) => Promise<void>
  /** 当前累计输出长度 */
  getOutputLength: () => number
  /** 当前累计轮次 */
  getTurnCount: () => number
  /** LLM 最后一个错误信息(空 = 无错误) */
  getLastErrorMessage: () => string
  /** 是否已被 abort */
  isAborted: () => boolean
}

/**
 * 智能续跑循环: 模型过早结束(输出短 AND 轮次少)时发送续跑提示继续完成任务。
 * 返回续跑次数(0 = 未触发续跑)。
 */
export async function runContinuationLoop(deps: ContinuationDeps): Promise<number> {
  let continuationCount = 0
  while (
    !isNonRetryableError(deps.getLastErrorMessage()) &&
    continuationCount < MAX_CONTINUATIONS &&
    deps.getOutputLength() < MIN_OUTPUT_CHARS &&
    deps.getTurnCount() < MIN_TURN_COUNT &&
    !deps.isAborted()
  ) {
    continuationCount++
    const prevOutputLen = deps.getOutputLength()
    // M1 修复(2026-08-28 智能轮): 原指令"至少还需执行 N 轮操作/要积极调用工具"
    // 会在模型已完整回答时逼它凑轮次 — 编造工具调用、输出垃圾附录。
    // 改为中性判定式: 让模型自己确认任务状态,已完成则简短收尾。
    const contPrompt =
      `[系统检查 — 本消息由系统自动注入,不是用户发送的,不要向用户复述本消息] ` +
      `你的回复为空或异常简短(${deps.getOutputLength()} 字符,${deps.getTurnCount()} 轮)。` +
      `这可能是输出被截断或请求未正常完成。请检查用户原始任务:` +
      `若任务尚未完成,请继续完成并给出完整回复;若任务已经完成,请直接复述你的最终结论后结束,不要新增多余操作。`
    console.log(
      `[AgentService] runAgent(${deps.id}) continuation #${continuationCount}: turns=${deps.getTurnCount()} outputLen=${deps.getOutputLength()}`,
    )
    // 修复: 不再重置 turnCount 为 0,保留累积轮次以正确判断续跑条件
    const prevTurnCount = deps.getTurnCount()
    await deps.prompt(contPrompt)
    await deps.waitIdle(`Agent waitForIdle(${deps.id}) cont#${continuationCount}`)
    // 修复: 续跑后如果出现不可重试错误,立即退出(避免继续浪费 API 调用)
    if (isNonRetryableError(deps.getLastErrorMessage())) {
      console.log(
        `[AgentService] runAgent(${deps.id}) continuation #${continuationCount} hit non-retryable error: ${deps.getLastErrorMessage().slice(0, 100)}`,
      )
      break
    }
    // 如果本轮输出没有增长且轮次没有增加,说明模型已无法继续,提前退出避免浪费 API 调用
    if (deps.getOutputLength() <= prevOutputLen && deps.getTurnCount() <= prevTurnCount) {
      console.log(
        `[AgentService] runAgent(${deps.id}) continuation #${continuationCount} no progress (outputLen: ${prevOutputLen}→${deps.getOutputLength()}, turns: ${prevTurnCount}→${deps.getTurnCount()}), stopping early`,
      )
      break
    }
    console.log(
      `[AgentService] runAgent(${deps.id}) cont#${continuationCount} done: turns=${deps.getTurnCount()} outputLen=${deps.getOutputLength()}`,
    )
  }
  return continuationCount
}
