// =============================================================
// Agent 链路的带重试 streamFn(R2+ 流畅度/可靠性审计; 2026-08-28 智能轮重写)
//
// 背景: pi-ai 的 streamSimple 是同步建流 — HTTP 请求在分离的 async IIFE 里,
// 429/超时/网络错误不会抛出,而是以 {type:'error'} 事件推入流中
// (openai-completions.js / anthropic-messages.js 同一模式);
// pi-agent-core 的 agent-loop 经 for-await 的 case "error" 消费。
// 旧版只 try/catch 建流同步异常,对真实的主流错误(流内 error 事件)从不触发
// — "已接重试"名存实亡。
//
// 策略(与 ChatStreamRunner 同口径):
//   - 返回包装流,事件级拦截: 「尚未转发任何内容事件」时遇到可重试 error
//     → 丢弃本次尝试,按指数退避静默换流重建(用户零感知);
//   - 'start' 事件缓冲到首个内容事件再转发 — 若重试,agent-loop 不会看到
//     第二个 start(它会对每个 start push 一条 partial,重复 start 会污染 messages);
//   - 已转发内容后遇到 error 不重试(避免重复输出);
//   - 建流同步抛错(鉴权 assert 等)保留重试判断,不可重试时以合成
//     error 事件收尾(消费方 await result() 不会悬空)。
//
// P0-2(2026-09-13 深查修复): 移植直连路径(pi-ai/streaming.ts R-TIMEOUT)的
// 「首字节超时」— providerTimeoutMs 内无任何事件 → abort 本次尝试并进入
// 自动重试。修复前 agent 链路单请求无超时上限,provider 挂起(不返回任何
// 字节)时整轮运行干等到被外部 abort,用户看到纯沉默(09-13 22:05 实锤:
// 挂死 180s 零重试零提示)。超时 abort 的 reason 含 'timeout' →
// isRetryableError 命中 → 换流重建;长生成不受影响(首事件即取消计时)。
// =============================================================

// AssistantMessageEventStream 类名被包根的 type-only 再导出遮蔽(TS1362),无法直接 new;
// 同模块的工厂函数无此冲突,作为值导入(根 index 为纯 re-export,无副作用)
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, AssistantMessageEvent, Model } from '@earendil-works/pi-ai/compat'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { errText } from '../../utils/err-text'
import { readRetrySettings } from '../pi-ai/retry-settings'
import { backoffDelayMs, isRetryableError, zeroedUsage } from '../pi-ai-helpers'

/** 构造最小合法的 error 事件(agent-loop 以 result() 提取该消息作为最终输出) */
function syntheticErrorEvent(model: Model<Api>, message: string): AssistantMessageEvent {
  return {
    type: 'error',
    reason: 'error',
    error: {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: zeroedUsage(),
      stopReason: 'error',
      errorMessage: message,
      timestamp: Date.now(),
    },
  }
}

/** 构造带事件级重试的 streamFn — 在 execution.ts 替代裸 streamSimple 注入 Agent */
export function createRetryingStreamFn() {
  return async (...args: Parameters<typeof streamSimple>) => {
    // 默认值与 ChatStreamRunner/直连路径一致: enabled/3 次/1000ms 起步/首字节超时 60s
    let retry = { enabled: true, maxRetries: 3, baseDelayMs: 1000, providerTimeoutMs: 60_000 }
    try {
      retry = readRetrySettings()
    } catch {
      /* settings 不可用时用默认值 */
    }
    const { enabled, maxRetries, baseDelayMs, providerTimeoutMs } = retry
    const signal = args[2]?.signal
    const model = args[0]
    const wrapper = createAssistantMessageEventStream()

    // 泵为分离任务: streamFn 契约要求立即返回流(agent-loop 同步拿到后才开始消费)
    void (async () => {
      let attempt = 0
      while (true) {
        let pendingStart: AssistantMessageEvent | null = null
        let committed = false // 是否已向 wrapper 转发过内容事件
        let retryNext = false // 本次尝试因可重试错误中止,应换流重建
        let sawTerminal = false // 已见 done/error 终止事件(正常收尾,不再合成 error)
        // P0-2 首字节超时: 内层 controller 隔离单次尝试;外层(运行级)abort 透传
        const streamAbort = new AbortController()
        let firstByteTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          streamAbort.abort(
            new Error(
              `Provider connection timeout (${providerTimeoutMs}ms 无响应, 已触发自动重试)`,
            ),
          )
        }, providerTimeoutMs)
        const onOuterAbort = () => streamAbort.abort()
        signal?.addEventListener('abort', onOuterAbort, { once: true })
        try {
          const underlying = streamSimple(args[0], args[1], {
            ...(args[2] ?? {}),
            signal: streamAbort.signal,
          })
          for await (const evt of underlying) {
            // 收到首事件即解除超时计时(长生成不受影响)
            if (firstByteTimer) {
              clearTimeout(firstByteTimer)
              firstByteTimer = null
            }
            if (evt.type === 'start') {
              // 缓冲: 等首个内容事件再转发(见文件头注释)
              pendingStart = evt
              continue
            }
            if (evt.type === 'error') {
              sawTerminal = true
              // 尚无内容事件 + 可重试 + 未达上限 + 未被 abort → 静默换流
              const errMsg = String(
                (evt as { error?: { errorMessage?: string } }).error?.errorMessage ?? '',
              )
              const canRetry =
                enabled && isRetryableError(errMsg) && attempt < maxRetries && !signal?.aborted
              if (!committed && canRetry) {
                const delay = backoffDelayMs(baseDelayMs, attempt)
                attempt++
                console.log(
                  `[Agent] stream error retry ${attempt}/${maxRetries} after ${delay}ms (error: ${errMsg})`,
                )
                await new Promise((resolve) => setTimeout(resolve, delay))
                retryNext = true
                break // 跳出 for-await, 经 while 重建流
              }
              // 不可重试/已输出: 原样收尾(补发缓冲的 start 保持 message_start 语义)
              if (!committed && pendingStart) wrapper.push(pendingStart)
              wrapper.push(evt)
              return
            }
            // 内容事件 / done
            if (evt.type === 'done') sawTerminal = true
            if (!committed) {
              if (pendingStart) wrapper.push(pendingStart)
              committed = true
            }
            wrapper.push(evt)
          }
          if (retryNext) continue
          // for-await 正常结束但从未出现 done/error 终止事件 → 流异常截断。
          // 合成 error 收尾,避免消费方 await result() 悬空
          // (正常 done 结束不再追加合成 error — 旧版每次成功都会多塞一条
          //  "Stream ended without a terminal event",污染下游事件流)
          if (sawTerminal) return
          if (!committed && pendingStart) wrapper.push(pendingStart)
          wrapper.push(syntheticErrorEvent(model, 'Stream ended without a terminal event'))
          return
        } catch (err) {
          // 建流同步抛错(鉴权/参数 assert)或泵自身异常。
          // !signal?.aborted 门(P0-2 补): 用户停止运行 → 外层 signal 已 abort,
          // 此时任何错误(含 SDK 的 "Request was aborted")不得触发重试,
          // 否则会把用户刚停掉的运行又拉起来。
          const message = errText(err)
          const canRetry =
            enabled && isRetryableError(message) && attempt < maxRetries && !signal?.aborted
          if (!canRetry) {
            wrapper.push(syntheticErrorEvent(model, message))
            return
          }
          const delay = backoffDelayMs(baseDelayMs, attempt)
          attempt++
          console.log(
            `[Agent] stream creation retry ${attempt}/${maxRetries} after ${delay}ms (error: ${message})`,
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
        } finally {
          if (firstByteTimer) clearTimeout(firstByteTimer)
          signal?.removeEventListener('abort', onOuterAbort)
        }
      }
    })()

    return wrapper
  }
}
