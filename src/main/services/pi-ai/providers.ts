// =============================================================
// Pi AI — Provider 元数据: 常量表 / 列表 / OAuth 引导登录
// 从 pi-ai-service.ts 拆出。逻辑零修改(逐行对照搬迁)。
// =============================================================

import { getEnvApiKey, getProviders } from '@earendil-works/pi-ai/compat'
import type { ProviderInfo } from '@shared/types'
import { keystoreService } from '../keystore-service'
import { settingsService } from '../settings-service'
import { safeGetModels } from './model-utils'

// OAuth 支持的 provider 列表
export const OAUTH_PROVIDERS = new Set(['anthropic', 'github-copilot', 'openai-codex'])

// OAuth provider 的 API Key 获取页面
export const OAUTH_KEY_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  'github-copilot': 'https://github.com/settings/tokens',
  'openai-codex': 'https://platform.openai.com/api-keys',
}

// Provider 显示名称映射
export const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  'google-vertex': 'Google Vertex AI',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI',
  'openai-codex': 'OpenAI Codex',
  deepseek: 'DeepSeek',
  'github-copilot': 'GitHub Copilot',
  xai: 'xAI (Grok)',
  groq: 'Groq',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  zai: 'Z.AI',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (中国)',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (中国)',
  huggingface: 'Hugging Face',
  fireworks: 'Fireworks AI',
  together: 'Together AI',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'kimi-coding': 'Kimi Coding',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  // pi-ai 0.84.2 新增厂商（对照 vendor/pi-ai/dist/models.generated.js 注册表）
  baseten: 'Baseten',
  radius: 'Radius',
  'ant-ling': 'Ant Ling (蚂蚁灵)',
  nvidia: 'NVIDIA',
  'qwen-token-plan': 'Qwen Token Plan',
  'qwen-token-plan-cn': 'Qwen Token Plan (中国)',
  'qwen-token-plan-individual': 'Qwen Token Plan (个人)',
  'zai-coding-cn': 'Z.AI Coding (中国)',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-cn': 'Xiaomi (中国)',
  'xiaomi-token-plan-ams': 'Xiaomi (AMS)',
  'xiaomi-token-plan-sgp': 'Xiaomi (SGP)',
}

/** 列出所有已注册的 Provider（标记黑名单而非过滤） */
export async function listProviders(): Promise<ProviderInfo[]> {
  await keystoreService.ready()
  const settings = settingsService.getSettings()
  const blacklist = settings.models.providerBlacklist ?? []
  // ✅ [Settings wiring] 读取 models.enabledModels — 只在白名单里的 model 才暴露
  const enabledModels = settings.models.enabledModels ?? []
  // ✅ [Settings wiring] 读取 models.transport / cacheRetention 供调用方参考
  const transport = settings.models.transport ?? 'auto'
  const cacheRetention = settings.models.cacheRetention ?? 'short'
  console.log(
    `[PiAI] transport=${transport} cacheRetention=${cacheRetention} enabledModels=[${enabledModels.join(', ') || 'all'}]`,
  )
  const providerIds = getProviders()

  const keystoreProviders = keystoreService.listProviders()
  const envKeyProviders = providerIds.filter((id) => !!getEnvApiKey(id))
  console.log(`[PiAI] getProviders() returned ${providerIds.length} providers`)
  console.log(`[PiAI] Keystore has keys for: [${keystoreProviders.join(', ')}]`)
  console.log(`[PiAI] Env API keys found for: [${envKeyProviders.join(', ')}]`)

  const results: ProviderInfo[] = providerIds.map((id) => {
    const models = safeGetModels(id)
    // ✅ 应用 enabledModels 过滤:若白名单非空,只保留白名单里的 model
    const filteredModels =
      enabledModels.length > 0 ? models.filter((m) => enabledModels.includes(m.id)) : models
    const keystoreKey = keystoreService.getApiKey(id)
    const envKey = getEnvApiKey(id)
    const hasApiKey = !!(keystoreKey || envKey)
    // 检测免费模型：input + output 均 0 成本（如 zai 全系、opencode 的 *-free、kimi-coding）
    const hasFreeModels = models.some(
      (m) => (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0,
    )

    return {
      id,
      name: PROVIDER_NAMES[id] ?? id,
      supportsOAuth: OAUTH_PROVIDERS.has(id),
      hasApiKey,
      modelCount: filteredModels.length,
      hasFreeModels,
      // 若 enabledModels 把所有 model 都过滤掉了,标 disabled 提示用户
      hidden:
        blacklist.includes(id) ||
        (enabledModels.length > 0 && filteredModels.length === 0 && models.length > 0),
    }
  })

  // 注入本地 Ollama provider(如果可用)
  try {
    // 动态导入: ollama-service → detection 顶层 import electron,保持 providers.ts 纯数据依赖
    const { ollamaService } = await import('../ollama-service')
    const ollamaAvailable = await ollamaService.detect()
    if (ollamaAvailable) {
      const serveRunning = await ollamaService.isServeRunning()
      const ollamaModels = serveRunning ? await ollamaService.listModels() : []
      results.push({
        id: 'ollama',
        name: '本地模型 (Ollama)',
        supportsOAuth: false,
        hasApiKey: true, // keyless,但标记为 true 让排序和选择逻辑正常工作
        modelCount: ollamaModels.length,
        hasFreeModels: true, // 本地模型永远免费
        hidden: false,
      })
      console.log(
        `[PiAI] Ollama provider injected: available=${ollamaAvailable} models=${ollamaModels.length}`,
      )
    }
  } catch (err) {
    console.log(`[PiAI] Ollama detection skipped: ${err}`)
  }

  // 排序：免费模型 provider 优先（让用户更容易发现 zai/opencode/kimi 等免费选项）
  results.sort((a, b) => {
    if (a.hasFreeModels !== b.hasFreeModels) return a.hasFreeModels ? -1 : 1
    if (a.hasApiKey !== b.hasApiKey) return a.hasApiKey ? -1 : 1 // 已配置的靠前
    return a.name.localeCompare(b.name)
  })

  const configured = results.filter((p) => p.hasApiKey && p.modelCount > 0)
  console.log(
    `[PiAI] Configured providers (hasApiKey && modelCount>0): ${configured.length} -> [${configured.map((p) => p.id).join(', ')}]`,
  )

  return results
}

/**
 * 启动 OAuth 登录流程
 * 当前实现: 引导式 API Key 获取流程
 *   1. 打开 provider 的 API Key 页面
 *   2. 返回 authUrl 让前端显示引导信息
 *   3. 用户手动复制 Key 后通过 setApiKey 存入 keystore
 * TODO: 后续接入完整 PKCE/device-code 流程
 */
export async function oauthLogin(providerId: string): Promise<{
  success: boolean
  error?: string
  authUrl?: string
  pollInterval?: number
}> {
  if (!OAUTH_PROVIDERS.has(providerId)) {
    return {
      success: false,
      error: `Provider ${providerId} does not support OAuth. Please use API key instead.`,
    }
  }

  const keyUrl = OAUTH_KEY_URLS[providerId]
  if (!keyUrl) {
    return {
      success: false,
      error: `No key URL configured for provider ${providerId}.`,
    }
  }

  // 在系统浏览器中打开 API Key 页面
  try {
    const { shell } = await import('electron')
    await shell.openExternal(keyUrl)
  } catch (err) {
    console.warn('[PiAI] Failed to open OAuth URL:', err)
  }

  return {
    success: true,
    authUrl: keyUrl,
    pollInterval: 0,
  }
}
