import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureEaaProviderProfilePatch,
  mergeLlmProviderCredentials,
  readDefaultModelSelection,
  readLlmProviders,
  writeDefaultModelSelection,
} from '../provider-profile-patch'

describe('ensureEaaProviderProfilePatch', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('把 llm-pi-ai providers 写入官方 profile 层，且不含密钥', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    const path = ensureEaaProviderProfilePatch(dir, {
      'zai-coding-cn': {
        apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
        api: 'openai-completions',
        models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }],
      },
    })
    expect(path).toBe(join(dir, 'cordis.patch.yml'))
    const text = await readFile(path, 'utf8')
    expect(text).toContain('id: llm-pi-ai')
    expect(text).toContain('zai-coding-cn')
    expect(text).toContain('glm-5.3-flash')
    expect(text).toContain('EAA_DSH_ZAI_CODING_CN_API_KEY')
    expect(text).not.toMatch(/sk-|apiKey:\s*['\"]?[^E]/)
  })

  it('保留 profile 里已有的其它行', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    const existing = `# header
- id: ui-settings-general
  config:
    welcomeNoticeVersion: keep-me
`
    await writeFile(join(dir, 'cordis.patch.yml'), existing, 'utf8')
    ensureEaaProviderProfilePatch(dir, {
      'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' },
    })
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: ui-settings-general')
    expect(text).toContain('welcomeNoticeVersion: keep-me')
    expect(text).toContain('id: llm-pi-ai')
    expect(text).toContain('minimax-cn')
  })

  it('providers 为空时去掉 llm-pi-ai 行，不删其它行', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-patch-'))
    ensureEaaProviderProfilePatch(dir, {
      kimi: { apiKeyEnv: 'EAA_DSH_KIMI_API_KEY' },
    })
    await writeFile(
      join(dir, 'cordis.patch.yml'),
      `- id: keep
  config:
    x: 1
- id: llm-pi-ai
  config:
    providers:
      kimi:
        apiKeyEnv: EAA_DSH_KIMI_API_KEY
`,
      'utf8',
    )
    ensureEaaProviderProfilePatch(dir, {})
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: keep')
    expect(text).not.toContain('id: llm-pi-ai')
    expect(text).not.toContain('kimi')
  })
})


describe('mergeLlmProviderCredentials and default model', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('merges apiKeyEnv without overwriting existing models or deleting other routes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-merge-'))
    ensureEaaProviderProfilePatch(dir, {
      'zai-coding-cn': {
        apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
        models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }],
      },
    })
    mergeLlmProviderCredentials(dir, {
      'zai-coding-cn': { apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY' },
      'minimax-cn': { apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY' },
    })
    const providers = readLlmProviders(dir)
    expect(providers['zai-coding-cn']).toMatchObject({
      apiKeyEnv: 'EAA_DSH_ZAI_CODING_CN_API_KEY',
    })
    expect(providers['zai-coding-cn'].models).toEqual([
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' },
    ])
    expect(providers['minimax-cn']).toEqual({
      apiKeyEnv: 'EAA_DSH_MINIMAX_CN_API_KEY',
    })
  })

  it('writes and reads official agent-default-model without secrets', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-profile-default-'))
    writeDefaultModelSelection(dir, { provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
    expect(readDefaultModelSelection(dir)).toEqual({
      provider: 'zai-coding-cn',
      model: 'glm-5.3-flash',
      reasoningEffort: undefined,
    })
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: agent-default-model')
    expect(text).toContain('glm-5.3-flash')
    expect(text).not.toMatch(/sk-/)
  })
})
