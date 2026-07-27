// =============================================================
// PiAIService — 常量映射 / selectCheapestModel / mapEvent / resolveModel / abort 逻辑测试
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// ===========================================================
// Module-level constants — inline replicas for testing
// ===========================================================

const OAUTH_PROVIDERS = new Set(['anthropic', 'github-copilot', 'openai-codex'])

const OAUTH_KEY_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  'github-copilot': 'https://github.com/settings/tokens',
  'openai-codex': 'https://platform.openai.com/api-keys',
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  deepseek: 'DeepSeek',
  xai: 'xAI (Grok)',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (中国)',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (中国)',
  zai: 'Z.AI',
  opencode: 'OpenCode',
  'kimi-coding': 'Kimi Coding',
  fireworks: 'Fireworks AI',
  together: 'Together AI',
  cerebras: 'Cerebras',
  huggingface: 'Hugging Face',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  xiaomi: 'Xiaomi MiMo',
}

// ===========================================================
// Inline replicas of private methods for unit testing
// ===========================================================

function selectCheapestModel<T extends {
  cost?: { input?: number; output?: number }
}>(models: T[]): T {
  if (models.length === 0) {
    throw new Error('selectCheapestModel: empty model list')
  }
  const score = (m: T): number => {
    const input = Number.isFinite(m.cost?.input) ? m.cost!.input! : Number.POSITIVE_INFINITY
    const output = Number.isFinite(m.cost?.output) ? m.cost!.output! : Number.POSITIVE_INFINITY
    return input + output
  }
  return models.reduce((cheapest, m) => (score(m) < score(cheapest) ? m : cheapest))
}

describe('OAUTH_PROVIDERS', () => {
  it('包含 anthropic', () => {
    expect(OAUTH_PROVIDERS.has('anthropic')).toBe(true)
  })
  it('包含 github-copilot', () => {
    expect(OAUTH_PROVIDERS.has('github-copilot')).toBe(true)
  })
  it('包含 openai-codex', () => {
    expect(OAUTH_PROVIDERS.has('openai-codex')).toBe(true)
  })
  it('不包含 openai', () => {
    expect(OAUTH_PROVIDERS.has('openai')).toBe(false)
  })
  it('不包含 google', () => {
    expect(OAUTH_PROVIDERS.has('google')).toBe(false)
  })
  it('不包含未知 provider', () => {
    expect(OAUTH_PROVIDERS.has('nonexistent')).toBe(false)
  })
  it('大小写敏感', () => {
    expect(OAUTH_PROVIDERS.has('Anthropic')).toBe(false)
  })
  it('size 为 3', () => {
    expect(OAUTH_PROVIDERS.size).toBe(3)
  })
})

describe('OAUTH_KEY_URLS', () => {
  it('anthropic URL 正确', () => {
    expect(OAUTH_KEY_URLS.anthropic).toBe('https://console.anthropic.com/settings/keys')
  })
  it('github-copilot URL 正确', () => {
    expect(OAUTH_KEY_URLS['github-copilot']).toBe('https://github.com/settings/tokens')
  })
  it('openai-codex URL 正确', () => {
    expect(OAUTH_KEY_URLS['openai-codex']).toBe('https://platform.openai.com/api-keys')
  })
  it('每个 OAuth provider 都有 key URL', () => {
    for (const p of OAUTH_PROVIDERS) {
      expect(OAUTH_KEY_URLS[p]).toBeDefined()
      expect(OAUTH_KEY_URLS[p]).toMatch(/^https:\/\//)
    }
  })
  it('非 OAuth provider 没有 key URL', () => {
    expect(OAUTH_KEY_URLS.openai).toBeUndefined()
    expect(OAUTH_KEY_URLS.google).toBeUndefined()
  })
})

describe('PROVIDER_NAMES', () => {
  it('openai → "OpenAI"', () => {
    expect(PROVIDER_NAMES.openai).toBe('OpenAI')
  })
  it('未知 provider → fallback to id', () => {
    const id = 'some-unknown-provider'
    const name = PROVIDER_NAMES[id] ?? id
    expect(name).toBe(id)
  })
  it('所有名称非空', () => {
    for (const [id, name] of Object.entries(PROVIDER_NAMES)) {
      expect(name.length).toBeGreaterThan(0)
      expect(typeof name).toBe('string')
    }
  })
  it('中国版 provider 名称含"(中国)"', () => {
    expect(PROVIDER_NAMES['minimax-cn']).toContain('中国')
    expect(PROVIDER_NAMES['moonshotai-cn']).toContain('中国')
  })
  it('至少 20 个 provider', () => {
    expect(Object.keys(PROVIDER_NAMES).length).toBeGreaterThanOrEqual(20)
  })
  it('zai → "Z.AI"', () => {
    expect(PROVIDER_NAMES.zai).toBe('Z.AI')
  })
  it('kimi-coding → "Kimi Coding"', () => {
    expect(PROVIDER_NAMES['kimi-coding']).toBe('Kimi Coding')
  })
  it('xiaomi → "Xiaomi MiMo"', () => {
    expect(PROVIDER_NAMES.xiaomi).toBe('Xiaomi MiMo')
  })
})

describe('selectCheapestModel', () => {
  const models = [
    { id: 'a', cost: { input: 1, output: 2 } },
    { id: 'b', cost: { input: 0.5, output: 0.5 } },
    { id: 'c', cost: { input: 3, output: 1 } },
  ]

  it('选择总成本最低的模型', () => {
    expect(selectCheapestModel(models).id).toBe('b')
  })

  it('单元素数组 → 返回唯一元素', () => {
    expect(selectCheapestModel([{ id: 'x', cost: { input: 10, output: 10 } }]).id).toBe('x')
  })

  it('cost undefined → 视为 Infinity', () => {
    const withUndef = [
      { id: 'a', cost: { input: 1, output: 1 } },
      { id: 'b', cost: {} },
    ]
    expect(selectCheapestModel(withUndef).id).toBe('a')
  })

  it('全部 cost undefined → 选第一个(reduce 初始值)', () => {
    const allUndef = [
      { id: 'a', cost: {} },
      { id: 'b', cost: {} },
    ]
    // 两个都是 Infinity,reduce 不更新(Infinity < Infinity 是 false)
    expect(selectCheapestModel(allUndef).id).toBe('a')
  })

  it('cost 全 0 → 免费模型', () => {
    const free = [
      { id: 'a', cost: { input: 0, output: 0 } },
      { id: 'b', cost: { input: 0, output: 0 } },
    ]
    expect(selectCheapestModel(free).id).toBe('a')
  })

  it('空数组 → throw', () => {
    expect(() => selectCheapestModel([])).toThrow(/empty model list/)
  })

  it('NaN input → 视为 Infinity', () => {
    const withNaN = [
      { id: 'a', cost: { input: NaN, output: 1 } },
      { id: 'b', cost: { input: 2, output: 2 } },
    ]
    expect(selectCheapestModel(withNaN).id).toBe('b')
  })

  it('负数成本(异常) → 仍参与比较', () => {
    const withNeg = [
      { id: 'a', cost: { input: -1, output: -1 } },
      { id: 'b', cost: { input: 0, output: 0 } },
    ]
    expect(selectCheapestModel(withNeg).id).toBe('a')
  })

  it('大数组仍正确', () => {
    const big = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`,
      cost: { input: 100 - i, output: 0 },
    }))
    expect(selectCheapestModel(big).id).toBe('m99')
  })

  it('多个并列最低 → 选第一个遇到的', () => {
    const tie = [
      { id: 'a', cost: { input: 1, output: 1 } },
      { id: 'b', cost: { input: 1, output: 1 } },
    ]
    expect(selectCheapestModel(tie).id).toBe('a')
  })
})

describe('mapEvent — StreamEvent 映射逻辑', () => {
  // mapEvent is private; we test the switch logic inline
  function mapEvent(event: { type: string; [key: string]: unknown }): Record<string, unknown> | null {
    switch (event.type) {
      case 'start': return null
      case 'text_start': return { type: 'text_start' }
      case 'text_delta': return { type: 'text_delta', delta: event.delta }
      case 'text_end': return { type: 'text_end' }
      case 'thinking_start': return { type: 'thinking_start' }
      case 'thinking_delta': return { type: 'thinking_delta', delta: event.delta }
      case 'thinking_end': return { type: 'thinking_end' }
      case 'toolcall_start': return { type: 'toolcall_start', id: event.id, name: event.name }
      case 'toolcall_delta': return { type: 'toolcall_delta', id: '', argsDelta: event.delta }
      case 'toolcall_end': return { type: 'toolcall_end', id: event.toolCallId }
      case 'done': return {
        type: 'done',
        usage: {
          inputTokens: (event.usage as { input?: number })?.input ?? 0,
          outputTokens: (event.usage as { output?: number })?.output ?? 0,
          cacheReadTokens: (event.usage as { cacheRead?: number })?.cacheRead ?? 0,
          cacheWriteTokens: (event.usage as { cacheWrite?: number })?.cacheWrite ?? 0,
        },
        cost: (event.usage as { cost?: { total?: number } })?.cost?.total ?? 0,
      }
      case 'error': return {
        type: 'error',
        message: event.errorMessage ?? 'Unknown error',
        retryable: event.reason === 'aborted',
      }
      default: return null
    }
  }

  it('start → null', () => {
    expect(mapEvent({ type: 'start' })).toBeNull()
  })
  it('text_start → { type: "text_start" }', () => {
    expect(mapEvent({ type: 'text_start' })).toEqual({ type: 'text_start' })
  })
  it('text_delta preserves delta', () => {
    expect(mapEvent({ type: 'text_delta', delta: 'hello' })).toEqual({ type: 'text_delta', delta: 'hello' })
  })
  it('text_end → { type: "text_end" }', () => {
    expect(mapEvent({ type: 'text_end' })).toEqual({ type: 'text_end' })
  })
  it('thinking_start → { type: "thinking_start" }', () => {
    expect(mapEvent({ type: 'thinking_start' })).toEqual({ type: 'thinking_start' })
  })
  it('thinking_delta preserves delta', () => {
    expect(mapEvent({ type: 'thinking_delta', delta: 'thought' })).toEqual({ type: 'thinking_delta', delta: 'thought' })
  })
  it('thinking_end → { type: "thinking_end" }', () => {
    expect(mapEvent({ type: 'thinking_end' })).toEqual({ type: 'thinking_end' })
  })
  it('done with usage → maps fields', () => {
    const r = mapEvent({ type: 'done', usage: { input: 100, output: 200, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } } })
    expect(r).toEqual({
      type: 'done',
      usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 10, cacheWriteTokens: 5 },
      cost: 0.01,
    })
  })
  it('done without usage → defaults 0', () => {
    const r = mapEvent({ type: 'done' })
    expect(r).toEqual({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0,
    })
  })
  it('error with errorMessage → mapped', () => {
    const r = mapEvent({ type: 'error', errorMessage: 'rate limited', reason: 'aborted' })
    expect(r).toEqual({ type: 'error', message: 'rate limited', retryable: true })
  })
  it('error without errorMessage → "Unknown error"', () => {
    const r = mapEvent({ type: 'error', reason: 'other' })
    expect(r).toEqual({ type: 'error', message: 'Unknown error', retryable: false })
  })
  it('unknown event type → null', () => {
    expect(mapEvent({ type: 'unknown_type' })).toBeNull()
  })
  it('empty type → null', () => {
    expect(mapEvent({ type: '' })).toBeNull()
  })
})

describe('resolveModel — 自定义模型 contextWindow 兜底逻辑', () => {
  // Inline replica of the contextWindow resolution logic from resolveModel
  function resolveContextWindow(custom: { contextWindow?: number }): number {
    return typeof custom.contextWindow === 'number' && custom.contextWindow > 0
      ? custom.contextWindow
      : 900000
  }

  it('用户设置有效 contextWindow → 使用用户值', () => {
    expect(resolveContextWindow({ contextWindow: 128000 })).toBe(128000)
  })
  it('contextWindow = 0 → 兜底 900000', () => {
    expect(resolveContextWindow({ contextWindow: 0 })).toBe(900000)
  })
  it('contextWindow = -1 → 兜底 900000', () => {
    expect(resolveContextWindow({ contextWindow: -1 })).toBe(900000)
  })
  it('contextWindow undefined → 兜底 900000', () => {
    expect(resolveContextWindow({})).toBe(900000)
  })
  it('contextWindow = 1 → 使用 1', () => {
    expect(resolveContextWindow({ contextWindow: 1 })).toBe(1)
  })
  it('contextWindow 为极大值 → 透传', () => {
    expect(resolveContextWindow({ contextWindow: 2_000_000 })).toBe(2_000_000)
  })
  it('contextWindow 为小数 → 透传(>0)', () => {
    expect(resolveContextWindow({ contextWindow: 0.5 })).toBe(0.5)
  })
  it('contextWindow = NaN → 兜底(typeof NaN === number 但 NaN > 0 false)', () => {
    expect(resolveContextWindow({ contextWindow: NaN })).toBe(900000)
  })
})

describe('fetchProviderModels — URL 构造逻辑', () => {
  // Inline replica of the URL construction
  function buildModelsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/models`
  }

  it('普通 baseUrl → 正确拼接', () => {
    expect(buildModelsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models')
  })
  it('尾部单个斜杠 → 去除后拼接', () => {
    expect(buildModelsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/models')
  })
  it('尾部多个斜杠 → 全部去除', () => {
    expect(buildModelsUrl('https://api.openai.com/v1//')).toBe('https://api.openai.com/v1/models')
  })
  it('尾部三个斜杠 → 全部去除', () => {
    expect(buildModelsUrl('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1/models')
  })
  it('无路径 baseUrl → 拼接', () => {
    expect(buildModelsUrl('https://api.example.com')).toBe('https://api.example.com/models')
  })
})
