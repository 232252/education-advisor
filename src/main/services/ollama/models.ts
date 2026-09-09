// =============================================================
// Ollama 模型管理 — 已安装模型列表 / 删除模型
//
// 需要 serve 在运行。
// =============================================================

import { errText } from '../../utils/err-text'
import { HEALTH_TIMEOUT_MS, OLLAMA_BASE_URL } from './constants'
import type { OllamaModel } from './types'

/**
 * 已装模型缓存(正 10s / 负 30s): agent 运行前预取列表只为校验模型存在,
 * Ollama 服务未起时每次运行都白等 3s 超时 — 负缓存把重复探测挡掉。
 * 需要实时结果的调用方(Models 页刷新)传 { fresh: true } 绕过。
 */
let cache: { at: number; models: OllamaModel[] } | null = null
const POSITIVE_TTL_MS = 10_000
const NEGATIVE_TTL_MS = 30_000

/**
 * 列出已安装模型。
 * 需要 serve 在运行。
 */
export async function listModels(options?: { fresh?: boolean }): Promise<OllamaModel[]> {
  if (!options?.fresh && cache) {
    const ttl = cache.models.length > 0 ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
    if (Date.now() - cache.at < ttl) return cache.models
  }
  let models: OllamaModel[] = []
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (res.ok) {
      const data = (await res.json()) as { models?: OllamaModel[] }
      models = data.models ?? []
    }
  } catch {
    models = []
  }
  cache = { at: Date.now(), models }
  return models
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
    const msg = errText(err)
    return { success: false, error: msg }
  }
}
