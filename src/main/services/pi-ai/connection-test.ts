// =============================================================
// Pi AI — Provider 连接测试(最小请求验证 API Key)
// 从 pi-ai-service.ts testConnection 下沉(纯重构,行为零变化)
// =============================================================

import { type Context, completeSimple, getEnvApiKey } from '@earendil-works/pi-ai/compat'
import type { TestConnectionResult } from '@shared/types'
import { keystoreService } from '../keystore-service'
import { selectCheapestModel } from '../pi-ai-helpers'
import { safeGetModels } from './model-utils'

/** 测试 Provider 连接（发送一个最小请求验证 API Key） */
export async function testProviderConnection(
  providerId: string,
  apiKey: string,
  _baseUrl?: string,
): Promise<TestConnectionResult> {
  const start = Date.now()
  const models = safeGetModels(providerId)

  // R169 修复: 当调用方未显式传入 apiKey 时,回退到 keystore / 环境变量
  // 此前 testConnection('minimax-cn', '') 返回 "No API key" 即使 keystore 已存储 key,
  // 导致用户在 Models 页面点击"测试"按钮时(输入框为空)无法测试已配置的 provider
  const resolvedApiKey = apiKey || keystoreService.getApiKey(providerId) || getEnvApiKey(providerId)

  if (models.length === 0) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      model: '',
      error: `No models available for provider: ${providerId}`,
    }
  }

  // 选择最便宜的模型做测试
  const testModel = selectCheapestModel(models)

  if (!resolvedApiKey) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      model: testModel.id,
      error: `No API key for provider: ${providerId}`,
    }
  }

  try {
    const context: Context = {
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
    }

    const result = await completeSimple(testModel, context, {
      apiKey: resolvedApiKey,
      maxTokens: 5,
    })

    const latencyMs = Date.now() - start

    if (result.stopReason === 'error') {
      return {
        success: false,
        latencyMs,
        model: testModel.id,
        error: result.errorMessage ?? 'Unknown error',
      }
    }

    return {
      success: true,
      latencyMs,
      model: testModel.id,
    }
  } catch (err: unknown) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      model: testModel.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
