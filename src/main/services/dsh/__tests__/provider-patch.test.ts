// =============================================================
// dsh 凭据/路由 patch 测试
//
// 这层存在的意义：不声明路由，app 按 pi 的 provider id 起 dsh 子进程就是
// `no adapter registered`；不注入 key，就是 MISSING_CREDENTIAL。两者都会让
// dsh 后端在用户视角「完全不能用」，所以这里把形状固定住：
//   · patch 里只有环境变量名，绝不落密钥值
//   · dsh-base 已占用的 deepseek-official 不重复声明，只喂它认的 DEEPSEEK_API_KEY
//   · 没有 key 时整层不带（config 是整行覆盖，写空 providers 会抹掉用户自己的配置）
// =============================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  buildEaaProviderPatchRows,
  configureDshCredentials,
  dshCredentialEnvName,
  dshProviderRouting,
  dshRouteFingerprint,
  dshSubprocessEnv,
  EAA_PROVIDER_PATCH_FILE,
  ensureEaaProviderPatch,
  providersToDeclare,
  providersWithKeys,
} from '../provider-patch'

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

describe('dshCredentialEnvName', () => {
  it('任何 provider id 都落在 dsh credentialRef 的语法内', () => {
    for (const id of ['kimi', 'openai', 'azure-openai', 'gpt-5', '中文', '', '!!weird!!']) {
      expect(dshCredentialEnvName(id)).toMatch(REF_PATTERN)
    }
  })

  it('同一 id 稳定，不同 id 不撞车', () => {
    expect(dshCredentialEnvName('kimi')).toBe(dshCredentialEnvName('kimi'))
    expect(new Set(['kimi', 'kimi_2', 'KIMI'].map(dshCredentialEnvName)).size).toBe(2)
  })
})

describe('dshProviderRouting', () => {
  it('常规 provider 声明成同名路由 + 指向注入的变量', () => {
    configureDshCredentials({
      listProviders: () => ['kimi', 'moonshot'],
      getApiKey: () => 'sk-probe-not-a-real-key',
    })
    const { profiles, envNames } = dshProviderRouting(['kimi', 'moonshot'])
    expect(profiles).toEqual({
      kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' },
      moonshot: { apiKeyEnv: 'EAA_DSH_MOONSHOT_API_KEY' },
    })
    expect(envNames).toEqual({
      EAA_DSH_KIMI_API_KEY: 'kimi',
      EAA_DSH_MOONSHOT_API_KEY: 'moonshot',
    })
    configureDshCredentials(null)
  })

  it('deepseek 走 dsh-base 的 llm-deepseek 行：不重复声明，只喂 DEEPSEEK_API_KEY', () => {
    const { profiles, envNames } = dshProviderRouting(['deepseek'])
    expect(profiles).toEqual({})
    expect(envNames).toEqual({ DEEPSEEK_API_KEY: 'deepseek' })
  })

  it('dsh-native 与非 native 混在一起时各归各的', () => {
    const { profiles, envNames } = dshProviderRouting(['deepseek', 'kimi'])
    expect(Object.keys(profiles)).toEqual(['kimi'])
    expect(envNames.DEEPSEEK_API_KEY).toBe('deepseek')
  })

  it('用户改过名时按改名后的路由声明', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk',
      dshRoutes: () => ({ kimi: '  my-gateway  ' }),
    })
    const { profiles } = dshProviderRouting(['kimi'])
    expect(profiles).toEqual({ 'my-gateway': { apiKeyEnv: 'EAA_DSH_MY_GATEWAY_API_KEY' } })
    configureDshCredentials(null)
  })

  it('改名表读取抛错时按同名直通', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk',
      dshRoutes: () => {
        throw new Error('settings not ready')
      },
    })
    expect(dshProviderRouting(['kimi']).profiles).toEqual({
      kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' },
    })
    configureDshCredentials(null)
  })

  it('空 id 忽略', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-probe-not-a-real-key',
    })
    expect(dshProviderRouting(['', 'kimi']).profiles).toEqual({
      kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' },
    })
    configureDshCredentials(null)
  })
})

describe('全目录压测（app 真实 vendor 里的 provider 全集）', () => {
  // 「30+ LLM」在 dsh 后端成立的前提是：每个 pi provider 都能拿到一条自己的路由
  // 与一个互不冲突的凭据变量名。这里直接读仓库里的 pi-ai 目录，不靠硬编码清单。
  const DATA_DIR = fileURLToPath(
    new URL('../../../../../vendor/pi-ai/dist/providers/data', import.meta.url),
  )
  const providerIds = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

  // 这一组要按「每个 provider 都存过 key」的真实形态算路由，探针 key 不是真值
  beforeEach(() => {
    configureDshCredentials({
      listProviders: () => providerIds,
      getApiKey: () => 'sk-probe-not-a-real-key',
    })
  })
  afterEach(() => configureDshCredentials(null))

  it('目录里确实有 30+ 个 provider', () => {
    expect(providerIds.length).toBeGreaterThanOrEqual(30)
  })

  it('每个 provider 的凭据变量名都合法且互不冲突', () => {
    const { profiles, envNames } = dshProviderRouting(providerIds)
    const names = Object.keys(envNames)
    // 每个 provider 都要有一个变量名（要么自己声明的，要么 dsh 内建行的）
    expect(names).toHaveLength(providerIds.length)
    // 两条不同路由不能共用一个变量名，否则一个 key 会被发给另一个 provider
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(REF_PATTERN)
    for (const [route, profile] of Object.entries(profiles)) {
      expect(envNames[profile.apiKeyEnv as string]).toBeTruthy()
      expect(route).not.toBe('deepseek-official')
    }
  })

  it('整张表生成的 patch 是一份合法 cordis 数组且能被 dsh 解析的形状', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eaa-providers-all-'))
    try {
      const { profiles } = dshProviderRouting(providerIds)
      const path = ensureEaaProviderPatch(dir, profiles) as string
      const rows = parse(readFileSync(path, 'utf8')) as Array<{
        id: string
        config: { providers: Record<string, { apiKeyEnv: string }> }
      }>
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('llm-pi-ai')
      const declared = Object.keys(rows[0].config.providers)
      expect(declared.length).toBeGreaterThanOrEqual(providerIds.length - 1)
      // 密钥值绝不进 patch 文件
      const text = readFileSync(path, 'utf8')
      expect(text).not.toMatch(/sk-|Bearer|api[_-]?key\s*:\s*['"][A-Za-z0-9]/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('patch 内容与落盘', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-providers-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('是一行 llm-pi-ai 的 config.providers（cordis patch 顶层数组）', () => {
    const rows = buildEaaProviderPatchRows({ kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' } })
    expect(rows).toEqual([
      { id: 'llm-pi-ai', config: { providers: { kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' } } } },
    ])
  })

  it('路由名按字排序，内容一致时不重写文件', () => {
    const profiles = { moonshot: { apiKeyEnv: 'B' }, kimi: { apiKeyEnv: 'A' } }
    const path = ensureEaaProviderPatch(dir, profiles) as string
    expect(path).toBe(join(dir, EAA_PROVIDER_PATCH_FILE))
    const first = readFileSync(path, 'utf8')
    expect(Object.keys(parse(first)[0].config.providers)).toEqual(['kimi', 'moonshot'])
    // 再写一次：内容不变则不碰盘（每次起子进程都会走这里）
    ensureEaaProviderPatch(dir, { moonshot: { apiKeyEnv: 'B' }, kimi: { apiKeyEnv: 'A' } })
    expect(readFileSync(path, 'utf8')).toBe(first)
  })

  it('没有任何路由时不写文件（避免用空 providers 覆盖用户自己的 dsh 配置）', () => {
    expect(ensureEaaProviderPatch(dir, {})).toBeNull()
    expect(existsSync(join(dir, EAA_PROVIDER_PATCH_FILE))).toBe(false)
  })
})

describe('providersWithKeys / dshSubprocessEnv', () => {
  afterEach(() => configureDshCredentials(null))

  it('未注入凭据来源时按空处理，不抛', () => {
    configureDshCredentials(null)
    expect(providersWithKeys()).toEqual([])
  })

  it('凭据来源读取抛错时按空处理（不能让一次读失败挡住子进程启动）', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureDshCredentials({
      listProviders: () => {
        throw new Error('locked')
      },
      getApiKey: () => undefined,
    })
    expect(providersWithKeys()).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })

  it('没有 key 要带时不传 env（保留 SDK 自己的继承行为）', () => {
    expect(dshSubprocessEnv({ EAA_DSH_KIMI_API_KEY: 'kimi' }, () => undefined)).toBeUndefined()
    expect(dshSubprocessEnv({}, () => 'sk')).toBeUndefined()
  })

  it('带 key 时是父环境的完整超集（SDK 的 env 语义是整体替换）', () => {
    const env = dshSubprocessEnv(
      { EAA_DSH_KIMI_API_KEY: 'kimi', DEEPSEEK_API_KEY: 'deepseek' },
      (p) => (p === 'kimi' ? 'sk-kimi' : undefined),
    ) as Record<string, string>
    expect(env.EAA_DSH_KIMI_API_KEY).toBe('sk-kimi')
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('从注入的来源取 key 并写进对应变量', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-live',
    })
    const { profiles, envNames } = dshProviderRouting(providersWithKeys())
    const env = dshSubprocessEnv(envNames) as Record<string, string>
    expect(env[profiles.kimi.apiKeyEnv as string]).toBe('sk-live')
  })
})

describe('路由级覆盖（Base URL / retry / cacheRetention）随 patch 下发', () => {
  const keyed = (over: Record<string, unknown> = {}) => ({
    listProviders: () => ['openai', 'kimi'],
    getApiKey: (p: string) => (p === 'openai' ? 'sk-probe-openai' : undefined),
    modelsSettings: () => ({
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 800, providerTimeoutMs: 45000 },
      cacheRetention: 'long',
      customModels: { openai: [{ id: 'gpt-x', baseUrl: 'https://gateway.school.local/v1' }] },
      ...over,
    }),
  })

  it('用户在模型页填的 Base URL 与 retry.* 真的进到那条路由', () => {
    configureDshCredentials(keyed())
    const { profiles } = dshProviderRouting(['openai'])
    expect(profiles.openai).toEqual({
      apiKeyEnv: 'EAA_DSH_OPENAI_API_KEY',
      baseURL: 'https://gateway.school.local/v1',
      timeoutMs: 45000,
      cacheRetention: 'long',
      retryPolicy: { mode: 'normal', maxRetries: 2, backoff: { initialDelayMs: 800 } },
    })
  })

  it('自建端点但没存 key 的 provider 也要声明路由，只是不带 credentialRef', () => {
    configureDshCredentials({
      listProviders: () => [],
      getApiKey: () => undefined,
      modelsSettings: () => ({
        customModels: { openai: [{ id: 'local', baseUrl: 'http://127.0.0.1:11434/v1' }] },
      }),
    })
    const declared = providersToDeclare()
    expect(declared).toContain('openai')
    const { profiles } = dshProviderRouting(declared)
    expect(profiles.openai.apiKeyEnv).toBeUndefined()
    expect(profiles.openai.baseURL).toBe('http://127.0.0.1:11434/v1')
  })

  it('deepseek 一旦填了自建 Base URL 就改由 llm-pi-ai 声明（不再走 dsh 内建行）', () => {
    configureDshCredentials({
      listProviders: () => ['deepseek'],
      getApiKey: () => 'sk-probe-deepseek',
      modelsSettings: () => ({
        customModels: { deepseek: [{ id: 'm', baseUrl: 'https://mirror.school/v1' }] },
      }),
    })
    const declared = providersToDeclare()
    const { profiles, envNames } = dshProviderRouting(declared)
    // 内建行 deepseek-official 的 baseURL 由 dsh 写死，patch 覆盖不到 → 必须换名声明
    expect(profiles['deepseek-official']).toBeUndefined()
    expect(profiles.deepseek).toMatchObject({
      apiKeyEnv: 'EAA_DSH_DEEPSEEK_API_KEY',
      baseURL: 'https://mirror.school/v1',
    })
    expect(envNames.EAA_DSH_DEEPSEEK_API_KEY).toBe('deepseek')
    const env = dshSubprocessEnv(envNames) as Record<string, string>
    expect(env.EAA_DSH_DEEPSEEK_API_KEY).toBe('sk-probe-deepseek')
    configureDshCredentials(null)
  })

  it('没有 modelsSettings 时 patch 只带凭据变量名（旧形态，不拿默认值盖掉 dsh 的默认）', () => {
    configureDshCredentials({
      listProviders: () => ['kimi'],
      getApiKey: () => 'sk-probe',
    })
    const { profiles } = dshProviderRouting(['kimi'])
    expect(profiles.kimi).toEqual({ apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' })
    configureDshCredentials(null)
  })

  it('钉住的那条路由要自带 models 条目，别的路由不带（dsh 不沿用 pi 目录）', () => {
    configureDshCredentials({
      listProviders: () => ['kimi', 'moonshot'],
      getApiKey: () => 'sk-probe',
    })
    const { profiles } = dshProviderRouting(['kimi', 'moonshot'], {
      route: 'kimi',
      entry: { id: 'kimi-k2', contextWindow: 200000, maxTokens: 8192 },
    })
    expect(profiles.kimi.models).toEqual([
      { id: 'kimi-k2', contextWindow: 200000, maxTokens: 8192 },
    ])
    expect(profiles.moonshot).not.toHaveProperty('models')
    configureDshCredentials(null)
  })

  it('patch 文件落盘带 baseURL，且绝不落密钥值', () => {
    configureDshCredentials(keyed())
    const dir = mkdtempSync(join(tmpdir(), 'eaa-route-overrides-'))
    try {
      const path = ensureEaaProviderPatch(dir, dshProviderRouting(['openai']).profiles) as string
      const text = readFileSync(path, 'utf8')
      expect(text).toContain('baseURL: https://gateway.school.local/v1')
      expect(text).toContain('maxRetries: 2')
      expect(text).not.toContain('sk-probe-openai')
      const rows = parse(text) as Array<{ config: { providers: Record<string, unknown> } }>
      expect(rows[0].config.providers.openai).toMatchObject({
        apiKeyEnv: 'EAA_DSH_OPENAI_API_KEY',
        cacheRetention: 'long',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    configureDshCredentials(null)
  })
})

describe('dshRouteFingerprint（改 key / 改端点要换子进程）', () => {
  it('同一配置稳定，key 或 Base URL 一变就变', () => {
    configureDshCredentials({
      listProviders: () => ['openai'],
      getApiKey: () => 'sk-one',
      modelsSettings: () => ({ customModels: { openai: [{ id: 'm', baseUrl: 'https://a/v1' }] } }),
    })
    const first = dshRouteFingerprint('openai')
    expect(dshRouteFingerprint('openai')).toBe(first)
    configureDshCredentials({
      listProviders: () => ['openai'],
      getApiKey: () => 'sk-two',
      modelsSettings: () => ({ customModels: { openai: [{ id: 'm', baseUrl: 'https://a/v1' }] } }),
    })
    expect(dshRouteFingerprint('openai')).not.toBe(first)
    configureDshCredentials({
      listProviders: () => ['openai'],
      getApiKey: () => 'sk-two',
      modelsSettings: () => ({ customModels: { openai: [{ id: 'm', baseUrl: 'https://b/v1' }] } }),
    })
    expect(dshRouteFingerprint('openai')).not.toBe(first)
    configureDshCredentials(null)
  })

  it('指纹不可逆也不含密钥片段，能安全进缓存键与日志', () => {
    configureDshCredentials({
      listProviders: () => ['openai'],
      getApiKey: (p) => (p === 'openai' ? 'sk-super-secret-value' : undefined),
    })
    const fp = dshRouteFingerprint('openai')
    expect(fp).toMatch(/^[0-9a-f]{12}$/)
    expect(fp).not.toContain('secret')
    expect(dshRouteFingerprint('never-keyed')).toBe('')
    configureDshCredentials(null)
  })

  it('凭据来源读取抛错时返回空串而不是打断启动', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureDshCredentials({
      listProviders: () => ['openai'],
      getApiKey: () => {
        throw new Error('keystore locked')
      },
    })
    expect(dshRouteFingerprint('openai')).toBe('')
    expect(warn).toHaveBeenCalled()
    configureDshCredentials(null)
  })
})
