// =============================================================
// 一次性文本调用：压缩摘要、连接测试这类没有工具的短请求。
// 省略 apiKey 时，凭据由 dsh 子进程从本应用的密钥库读取。
// 传入 apiKey 时只注入这一次子进程（模型页「测试」在保存之前就要试通）。
// =============================================================

import { completeSimpleViaDsh } from './one-shot'
import { dshRouteFor } from './route'
import { createDshRuntime } from './runtime'

export async function completeDshText(opts: {
  provider: string
  model: string
  text: string
  maxTokens?: number
  signal?: AbortSignal
  /** 连接测试传入还没保存的密钥；省略则用密钥库里已有的那把 */
  apiKey?: string
}): Promise<{ text: string; stopReason?: 'aborted' }> {
  const route = dshRouteFor(opts.provider, opts.model)
  const runtime = createDshRuntime({
    provider: route.providerId,
    model: route.modelId,
    maxTokens: opts.maxTokens,
    ...(opts.apiKey ? { probeCredential: { providerId: opts.provider, apiKey: opts.apiKey } } : {}),
  })
  try {
    const result = await completeSimpleViaDsh({
      stream: runtime,
      providerId: route.providerId,
      modelId: route.modelId,
      content: [{ type: 'text', text: opts.text }],
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      cancel: () => {
        void runtime.dispose()
      },
    })
    return { text: result.text, stopReason: result.stopReason }
  } finally {
    await runtime.dispose().catch(() => {})
  }
}
