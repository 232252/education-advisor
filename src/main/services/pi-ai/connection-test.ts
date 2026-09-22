import type { Api, Context, Model } from '@main/services/llm-contracts'
// =============================================================
// Pi AI — Provider 连接测试(最小请求验证 API Key)
// 从 pi-ai-service.ts testConnection 下沉
// =============================================================

import { completeSimple, getEnvApiKey } from '@earendil-works/pi-ai/compat'
import type { TestConnectionResult } from '@shared/types'
import { errText } from '../../utils/err-text'
import { keystoreService } from '../keystore-service'
import {
  isAuthRejectedError,
  isModelPlanDeniedError,
  rankProbeModels,
  selectProbeModel,
} from '../pi-ai-helpers'
import { safeGetModels } from './model-utils'

/** 套餐无权限时最多换几个探测模型。密钥无效(401)不换。 */
const MAX_CONNECTION_PROBES = 3

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

  // 跳过 Highspeed 等套餐专属 SKU(目录标价 0,普通套餐会 429/1311)
  const probeModel = selectProbeModel(models)

  if (!resolvedApiKey) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      model: probeModel.id,
      error: `No API key for provider: ${providerId}`,
    }
  }

  const candidates = rankProbeModels(models).slice(0, MAX_CONNECTION_PROBES)
  let lastModelId = probeModel.id
  let lastError = 'Unknown error'

  for (const testModel of candidates) {
    lastModelId = testModel.id
    const probed = await probeOnce(testModel, resolvedApiKey)
    if (probed.ok) {
      return {
        success: true,
        latencyMs: Date.now() - start,
        model: testModel.id,
      }
    }
    lastError = probed.error
    if (isAuthRejectedError(lastError) || !isModelPlanDeniedError(lastError)) {
      break
    }
  }

  return {
    success: false,
    latencyMs: Date.now() - start,
    model: lastModelId,
    error: lastError,
  }
}

async function probeOnce(
  testModel: Model<Api>,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const context: Context = {
    messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
  }
  try {
    const result = await completeSimple(testModel, context, {
      apiKey,
      maxTokens: 5,
    })
    if (result.stopReason === 'error') {
      return { ok: false, error: result.errorMessage ?? 'Unknown error' }
    }
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: errText(err) }
  }
}
