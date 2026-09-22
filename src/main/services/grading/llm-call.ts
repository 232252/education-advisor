// =============================================================
// 批改链路的模型调用出口（pi / dsh 双后端）
//
// 与 pi-ai compat 的 completeSimple(model, context, options) 同签名、
// 同返回类型 AssistantMessage，因此各管线的 extractResult / extractText /
// stopReason==='aborted' 判定在 pi 路径上逐字不变。
//
// 后端选择：settings.models.agentRuntime，缺省 'dsh'（'pi' 为回退项）。
// =============================================================

import { completeSimple } from '@earendil-works/pi-ai/compat'
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
} from '@main/services/llm-contracts'
import { completeSimpleViaDsh } from '../dsh/one-shot'
import { dshRouteFor } from '../dsh/route'
import { createDshRuntime, type DshRuntime } from '../dsh/runtime'
import { settingsService } from '../settings-service'

export interface GradingCallOptions {
  apiKey: string
  maxTokens: number
  signal?: AbortSignal
  cacheRetention?: 'none' | 'short' | 'long'
  sessionId?: string
}

/**
 * dsh 的 provider/model 在 initialize 时进程级定死，故按其缓存一个运行时；
 * 换模型即重建（旧子进程随之关闭）。
 */
let dshRuntime: DshRuntime | null = null
let dshRoute = ''

function getDshRuntime(model: Model<Api>): DshRuntime {
  const route = dshRouteFor(String(model.provider), model.id)
  const key = `${route.providerId}/${route.modelId}`
  if (!dshRuntime || dshRoute !== key) {
    const previous = dshRuntime
    dshRuntime = createDshRuntime({ provider: route.providerId, model: route.modelId })
    dshRoute = key
    if (previous) void previous.dispose().catch(() => {})
  }
  return dshRuntime
}

/** 测试/设置变更用：丢弃已建立的 dsh 子进程 */
export function resetGradingDshRuntime(): void {
  const previous = dshRuntime
  dshRuntime = null
  dshRoute = ''
  if (previous) void previous.dispose().catch(() => {})
}

function readBackend(): 'pi' | 'dsh' {
  try {
    return settingsService.getSettings().models?.agentRuntime ?? 'dsh'
  } catch (err) {
    // 设置未就绪时按现网后端处理，读配置失败不该打断批改
    console.warn('[grading] settings unreadable, using pi runtime:', err)
    return 'pi'
  }
}

/** pi 的无成本口径（dsh usage 不带 cost，此处如实记 0） */
function emptyCost() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

/**
 * 单次批改调用。
 *
 * dsh 路径下 options.apiKey 不使用：SDK 没有按请求注入 key 的入口，凭据由
 * createDshRuntime 从 keystore 读同一把 key、经子进程环境交给 dsh（provider-patch.ts）。
 * options.signal 用「关停子进程」实现，返回 stopReason='aborted'，与 pi 路径同形。
 */
export async function completeGradingCall(
  model: Model<Api>,
  context: { systemPrompt: string; messages: Message[] },
  options: GradingCallOptions,
): Promise<AssistantMessage> {
  if (readBackend() === 'pi') return completeSimple(model, context, options)

  if (context.messages.length !== 1) {
    throw new Error(`dsh 后端仅支持单条 user 消息的批改调用，收到 ${context.messages.length} 条`)
  }
  const [only] = context.messages
  if (only.role !== 'user') {
    throw new Error(`dsh 后端要求 user 消息，收到 ${only.role}`)
  }
  const content: Array<TextContent | ImageContent> =
    typeof only.content === 'string' ? [{ type: 'text', text: only.content }] : only.content

  const route = dshRouteFor(String(model.provider), model.id)
  const runtime = getDshRuntime(model)
  const result = await completeSimpleViaDsh({
    stream: runtime,
    providerId: route.providerId,
    modelId: route.modelId,
    systemPrompt: context.systemPrompt,
    content,
    maxTokens: options.maxTokens,
    signal: options.signal,
    // 子进程已经没了，缓存必须一起丢：下次调用要重新握手
    cancel: () => resetGradingDshRuntime(),
  })

  const inputTokens = result.usage.inputTokens
  const outputTokens = result.usage.outputTokens
  return {
    role: 'assistant',
    timestamp: Date.now(),
    content: result.text ? [{ type: 'text', text: result.text }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: result.usage.cacheReadTokens,
      cacheWrite: result.usage.cacheWriteTokens,
      totalTokens: inputTokens + outputTokens,
      cost: emptyCost(),
    },
    stopReason: result.stopReason ?? 'stop',
  }
}
