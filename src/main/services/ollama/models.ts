// =============================================================
// Ollama 模型管理 — 已安装模型列表 / 删除模型
//
// 需要 serve 在运行。
// =============================================================

import { HEALTH_TIMEOUT_MS, OLLAMA_BASE_URL } from './constants'
import type { OllamaModel } from './types'

/**
 * 列出已安装模型。
 * 需要 serve 在运行。
 */
export async function listModels(): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: OllamaModel[] }
    return data.models ?? []
  } catch {
    return []
  }
}

/** 删除一个已安装模型 */
export async function deleteModel(
  modelName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(30000), // 30s 超时,删除大模型可能耗时
    })
    return { success: res.ok }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}
