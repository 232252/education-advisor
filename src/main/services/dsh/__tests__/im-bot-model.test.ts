import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureDshCatalogSource } from '../dsh-model-catalog'
import { configureDshModelSettings } from '../dsh-model-settings'
import {
  credentialedRouteIds,
  fillUnsetBotModels,
  imExposesReadImage,
  listedBotModels,
} from '../im-bot-model'

const SELECTION = { provider: 'zai-coding-cn', model: 'glm-5.3-flash' }

describe('fillUnsetBotModels', () => {
  let home: string

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true })
  })

  it('把有钥匙的路由收成集合，没注入的环境变量不算', () => {
    const routes = credentialedRouteIds(
      {
        EAA_DSH_ZAI_CODING_CN_API_KEY: 'zai-coding-cn',
        DEEPSEEK_API_KEY: 'deepseek',
      },
      { EAA_DSH_ZAI_CODING_CN_API_KEY: 'sk-test' },
    )
    expect([...routes]).toEqual(['zai-coding-cn'])
  })

  it('只给还没选模型的机器人写入，已有选择和别的字段保持不变', async () => {
    home = await mkdtemp(join(tmpdir(), 'eaa-im-bot-'))
    const weixin = join(home, 'integrations', 'dsh-weixin')
    const feishu = join(home, 'integrations', 'dsh-feishu')
    await mkdir(weixin, { recursive: true })
    await mkdir(feishu, { recursive: true })
    await writeFile(
      join(weixin, 'workspaces.json'),
      `${JSON.stringify(
        {
          version: 2,
          workspaces: { wx_bot: 'C:\\im' },
          accessPolicies: { wx_bot: { direct: { mode: 'allowlist' } } },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await writeFile(
      join(feishu, 'workspaces.json'),
      `${JSON.stringify(
        {
          version: 2,
          workspaces: { bot_feishu: 'C:\\im' },
          models: {
            bot_feishu: {
              provider: 'minimax-cn',
              model: 'MiniMax-M3.1-Flash',
              reasoningEffort: 'max',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await writeFile(
      join(weixin, 'state.json'),
      `${JSON.stringify({ sessions: { chat: 'session-d010eff0-5b79-46be-9cbe-d209adacff97' } })}\n`,
      'utf8',
    )

    const result = fillUnsetBotModels({
      home,
      selection: SELECTION,
      credentialedRoutes: new Set(['zai-coding-cn']),
    })

    expect(result.filled).toBe(1)
    const wx = JSON.parse(await readFile(join(weixin, 'workspaces.json'), 'utf8'))
    expect(wx.models.wx_bot).toEqual(SELECTION)
    expect(wx.accessPolicies.wx_bot.direct.mode).toBe('allowlist')
    const fs = JSON.parse(await readFile(join(feishu, 'workspaces.json'), 'utf8'))
    expect(fs.models.bot_feishu.provider).toBe('minimax-cn')
    const state = await readFile(join(weixin, 'state.json'), 'utf8')
    expect(state).toContain('session-d010eff0-5b79-46be-9cbe-d209adacff97')
  })

  it('当前路由没有钥匙时不改任何工作区', async () => {
    home = await mkdtemp(join(tmpdir(), 'eaa-im-bot-'))
    const weixin = join(home, 'integrations', 'dsh-weixin')
    await mkdir(weixin, { recursive: true })
    const original = `${JSON.stringify({ version: 2, workspaces: { wx_bot: 'C:\\im' } })}\n`
    await writeFile(join(weixin, 'workspaces.json'), original, 'utf8')

    const result = fillUnsetBotModels({
      home,
      selection: { provider: 'deepseek-official', model: 'deepseek-flash' },
      credentialedRoutes: new Set(['zai-coding-cn']),
    })

    expect(result.filled).toBe(0)
    expect(await readFile(join(weixin, 'workspaces.json'), 'utf8')).toBe(original)
  })

  it('读不到教师当前模型时不改文件', async () => {
    home = await mkdtemp(join(tmpdir(), 'eaa-im-bot-'))
    const weixin = join(home, 'integrations', 'dsh-weixin')
    await mkdir(weixin, { recursive: true })
    const original = `${JSON.stringify({ version: 2, workspaces: { wx_bot: 'C:\\im' } })}\n`
    await writeFile(join(weixin, 'workspaces.json'), original, 'utf8')

    const result = fillUnsetBotModels({
      home,
      selection: null,
      credentialedRoutes: new Set(['zai-coding-cn']),
    })

    expect(result.filled).toBe(0)
    expect(await readFile(join(weixin, 'workspaces.json'), 'utf8')).toBe(original)
  })

  it('读出各渠道已经选好的模型', async () => {
    home = await mkdtemp(join(tmpdir(), 'eaa-im-bot-'))
    const weixin = join(home, 'integrations', 'dsh-weixin')
    await mkdir(weixin, { recursive: true })
    await writeFile(
      join(weixin, 'workspaces.json'),
      `${JSON.stringify({
        models: {
          wx_bot: { provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'high' },
          broken: { provider: 'zai-coding-cn' },
        },
      })}\n`,
      'utf8',
    )
    expect(listedBotModels(home)).toEqual([
      { provider: 'zai-coding-cn', model: 'glm-5.3-flash', reasoningEffort: 'high' },
    ])
  })
})

describe('imExposesReadImage', () => {
  let home: string

  afterEach(async () => {
    configureDshCatalogSource(null)
    configureDshModelSettings('')
    if (home) await rm(home, { recursive: true, force: true })
  })

  it('渠道或当前路由里有视觉模型才挂 read_image', async () => {
    home = await mkdtemp(join(tmpdir(), 'eaa-im-vision-'))
    configureDshModelSettings('')
    configureDshCatalogSource({
      listProviders: () => [],
      listModels: (id) =>
        id === 'zai-coding-cn'
          ? [
              {
                id: 'glm-5.3-flash',
                name: 'GLM',
                api: 'openai-completions',
                contextWindow: 1,
                maxTokens: 1,
                input: ['text', 'image'],
                supportsReasoning: false,
                costPerInputToken: 0,
                costPerOutputToken: 0,
                costCacheRead: 0,
                costCacheWrite: 0,
                baseUrl: '',
              },
            ]
          : [],
    })
    expect(imExposesReadImage(home)).toBe(false)
    const weixin = join(home, 'integrations', 'dsh-weixin')
    await mkdir(weixin, { recursive: true })
    await writeFile(
      join(weixin, 'workspaces.json'),
      `${JSON.stringify({
        models: { wx_bot: { provider: 'zai-coding-cn', model: 'glm-5.3-flash' } },
      })}\n`,
      'utf8',
    )
    expect(imExposesReadImage(home)).toBe(true)
  })
})
