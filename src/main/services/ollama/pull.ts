// =============================================================
// Ollama 模型下载(pull) — 流式进度
//
// M-1 修复: 使用 AbortController 控制下载请求。
// =============================================================

import { OLLAMA_BASE_URL } from './constants'
import type { OllamaPullProgress } from './types'

/** 当前 pull 操作状态 */
export interface PullState {
  /** 当前 pull 的 AbortController,null 表示没有正在进行的 pull 操作 */
  abortController: AbortController | null
}

/**
 * 下载(pull)一个模型,流式返回进度。
 * M-1 修复: 使用 AbortController 支持取消下载(通过 cancelPull())。
 * @param modelName 模型名,如 "qwen3:1.7b"
 * @param onProgress 进度回调
 */
export async function pullModel(
  state: PullState,
  modelName: string,
  onProgress: (p: OllamaPullProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  // M-1 修复: 创建 AbortController,fetch + reader.read() 都受其控制
  state.abortController = new AbortController()
  const { signal } = state.abortController
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal,
    })
    if (!res.ok || !res.body) {
      return { success: false, error: `HTTP ${res.status}` }
    }
    // 逐行读取流式 JSON
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let success = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line) as OllamaPullProgress
          onProgress(evt)
          if (evt.status === 'success') success = true
        } catch {
          // 忽略解析失败的行
        }
      }
    }
    return { success }
  } catch (err) {
    // M-1 修复: abort 触发的 AbortError 视为用户取消,返回特定消息
    if (signal.aborted) {
      return { success: false, error: 'cancelled' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  } finally {
    state.abortController = null
  }
}
