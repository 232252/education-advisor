// =============================================================
// completeSimple 的 dsh 等价物 —— 单次调用、无工具
//
// 批改管线(grading/*)用的是 pi-ai compat 的
//   completeSimple(model, { systemPrompt, messages }, { apiKey, maxTokens })
// 这里提供同语义的 dsh 版本：一次 turn，拼文本增量，返回 { text, usage }。
//
// 鉴权差异（必须知道）：pi 是「按请求传 apiKey」，dsh 的 provider/model 与
// 凭据在 initialize 时进程级定死，SDK 没有按请求注入 key 的方法。因此本仓库
// 由 provider-patch.ts 把「app 存过 key 的 provider」声明成同名 dsh 路由，
// 再把 key 经子进程 env 注入 —— 用户不必再去 dsh 自己的配置里填一遍。
// =============================================================

import type { ImageContent, TextContent } from '@main/services/llm-contracts'
import type { StreamEvent, TokenUsage } from '@shared/types/ai'
import type { DshChatStreamParams, DshImageMimeType, DshPromptBlock } from './runtime'
import { DSH_TURN_ABORTED } from './stream-mapper'

const ALLOWED_IMAGE_MIME: readonly DshImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

export function isDshSupportedImage(mimeType: string): mimeType is DshImageMimeType {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mimeType)
}

/**
 * pi 的 content blocks → dsh prompt blocks。
 * 不支持的图片格式直接抛错：静默丢图会把一次视觉批改退化成纯文本调用，
 * 出一份看似正常的错答案。
 */
export function toDshPromptBlocks(
  content: readonly (TextContent | ImageContent)[],
): DshPromptBlock[] {
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (!isDshSupportedImage(part.mimeType)) {
      throw new Error(
        `dsh 不支持该图片格式: ${part.mimeType}（可用: ${ALLOWED_IMAGE_MIME.join(', ')}）`,
      )
    }
    return { type: 'image', data: part.data, mimeType: part.mimeType }
  })
}

/** 只需要 chatStream 能力；DshRuntime 即其实现，测试可注入替身 */
export interface DshStreamSource {
  chatStream(params: DshChatStreamParams): AsyncGenerator<StreamEvent>
}

export interface DshSimpleCallParams {
  stream: DshStreamSource
  providerId: string
  modelId: string
  systemPrompt?: string
  content: readonly (TextContent | ImageContent)[]
  maxTokens?: number
  /**
   * 调用方的取消信号。SDK 没有「取消这一轮」的入口（只有整体 shutdown），所以
   * 等价的取消动作是 {@link cancel} —— 由调用方关停子进程，这里如实返回 aborted。
   */
  signal?: AbortSignal
  /** signal 触发时调用一次；关停后流会以 transport 关闭抛出，由本函数收敛成 aborted */
  cancel?: () => void
}

export interface DshSimpleCallResult {
  text: string
  usage: TokenUsage
  /** 对齐 pi 的 AssistantMessage.stopReason：管线据此抛「已中止」 */
  stopReason?: 'aborted'
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** 单轮调用；失败由 DshRuntime 抛出（与管线既有的「异常经 IPC 信封返回」一致） */
export async function completeSimpleViaDsh(
  params: DshSimpleCallParams,
): Promise<DshSimpleCallResult> {
  const blocks = toDshPromptBlocks(params.content)
  let text = ''
  let usage: TokenUsage = ZERO_USAGE
  let aborted = false

  const fire = () => {
    if (aborted) return
    aborted = true
    params.cancel?.()
  }
  if (params.signal?.aborted) fire()
  else params.signal?.addEventListener('abort', fire, { once: true })

  try {
    if (!aborted) {
      for await (const event of params.stream.chatStream({
        providerId: params.providerId,
        modelId: params.modelId,
        messages: [],
        systemPrompt: params.systemPrompt,
        blocks,
        maxTokens: params.maxTokens,
      })) {
        if (event.type === 'text_delta') text += event.delta
        else if (event.type === 'done') usage = event.usage
        else if (event.type === 'error') {
          // aborted 交回调用方按 stopReason 处理（与 pi 路径同形）；其余错误直接抛出
          if (event.message === DSH_TURN_ABORTED) return { text, usage, stopReason: 'aborted' }
          throw new Error(event.message)
        }
        if (aborted) break
      }
    }
    if (aborted) return { text, usage: ZERO_USAGE, stopReason: 'aborted' }
    return { text, usage }
  } catch (err) {
    // 取消是靠关停子进程实现的，所以「关掉正在跑的流」必然抛 transport 错误；
    // 只有 aborted 时才有资格把它咽掉，否则真失败会被伪装成一次正常中止。
    // 实测：dsh 的助手文本随消息收尾成批出现，因此子进程被关时 text 通常是空的
    // （pi 的 aborted 会带上已生成部分）—— 批改侧只据此判「已中止」，不取半截结果。
    if (aborted) return { text, usage: ZERO_USAGE, stopReason: 'aborted' }
    throw err
  } finally {
    if (params.signal) params.signal.removeEventListener('abort', fire)
  }
}
