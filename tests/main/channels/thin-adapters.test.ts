// =============================================================
// thin overseas + email/yuanbao adapters — validateConfig 与诚实失败
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    getPath: vi.fn((n: string) => (n === 'userData' ? 'C:\\temp\\ea-test-userData' : '')),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('../../../src/main/utils/logger', () => ({
  log: vi.fn(),
  initLogger: vi.fn(),
  getLogFile: vi.fn(() => ''),
}))

import { createDiscordAdapter } from '../../../src/main/services/channels/adapters/discord'
import { createTelegramAdapter } from '../../../src/main/services/channels/adapters/telegram'
import { createSlackAdapter } from '../../../src/main/services/channels/adapters/slack'
import { createMatrixAdapter } from '../../../src/main/services/channels/adapters/matrix'
import { createMattermostAdapter } from '../../../src/main/services/channels/adapters/mattermost'
import { createEmailAdapter } from '../../../src/main/services/channels/adapters/email'
import { createYuanbaoAdapter } from '../../../src/main/services/channels/adapters/yuanbao'
import { createXiaoyiAdapter } from '../../../src/main/services/channels/adapters/xiaoyi'

function secrets(map: Record<string, string>) {
  return {
    config: {} as Record<string, unknown>,
    getSecret: async (name: string) => map[name] ?? null,
  }
}

describe('overseas thin adapters validateConfig', () => {
  it('discord 需要 botToken', async () => {
    const a = createDiscordAdapter()
    expect(a.manifest.region).toBe('foreign')
    expect(a.manifest.catalogStatus).toBe('enabled')
    const bad = await a.validateConfig(secrets({}))
    expect(bad.ok).toBe(false)
    const ok = await a.validateConfig({
      config: {},
      getSecret: async () => 'tok',
    })
    expect(ok.ok).toBe(true)
  })

  it('telegram / slack / matrix / mattermost 必填字段', async () => {
    expect((await createTelegramAdapter().validateConfig(secrets({}))).ok).toBe(false)
    expect(
      (
        await createTelegramAdapter().validateConfig({
          config: {},
          getSecret: async () => 't',
        })
      ).ok,
    ).toBe(true)

    expect((await createSlackAdapter().validateConfig(secrets({ botToken: 'x' }))).ok).toBe(false)
    expect(
      (
        await createSlackAdapter().validateConfig({
          config: {},
          getSecret: async (n) => (n === 'botToken' || n === 'appToken' ? 'x' : null),
        })
      ).ok,
    ).toBe(true)

    expect(
      (
        await createMatrixAdapter().validateConfig({
          config: { homeserver: 'https://matrix.org' },
          getSecret: async () => null,
        })
      ).ok,
    ).toBe(false)
    expect(
      (
        await createMatrixAdapter().validateConfig({
          config: { homeserver: 'https://matrix.org', userId: '@b:matrix.org' },
          getSecret: async () => 'tok',
        })
      ).ok,
    ).toBe(true)

    expect(
      (
        await createMattermostAdapter().validateConfig({
          config: { baseUrl: 'https://mm.example' },
          getSecret: async () => 'tok',
        })
      ).ok,
    ).toBe(true)
  })
})

describe('email / assistants', () => {
  it('email manifest 声明 imap-idle 且校验主机', async () => {
    const a = createEmailAdapter()
    expect(a.manifest.capabilities.receivesVia).toBe('imap-idle')
    expect(
      (
        await a.validateConfig({
          config: { imapHost: 'imap.ex', smtpHost: 'smtp.ex', username: 'a@b.c' },
          getSecret: async () => 'pw',
        })
      ).ok,
    ).toBe(true)
  })

  it('yuanbao/xiaoyi validateConfig 必填 + 能力位', async () => {
    const y = createYuanbaoAdapter()
    expect((await y.validateConfig(secrets({}))).ok).toBe(false)
    expect(
      (
        await y.validateConfig({
          config: { appId: 'k' },
          getSecret: async () => 's',
        })
      ).ok,
    ).toBe(true)
    expect(y.manifest.capabilities.receivesVia).toBe('ws')

    const x = createXiaoyiAdapter()
    expect((await x.validateConfig(secrets({}))).ok).toBe(false)
    expect(
      (
        await x.validateConfig({
          config: { accessKey: 'ak', agentId: 'ag' },
          getSecret: async () => 'sk',
        })
      ).ok,
    ).toBe(true)
    expect(x.manifest.capabilities.receivesVia).toBe('ws')
    expect(x.manifest.capabilities.streamingKind).toBe('edit-message')
  })

  it('yuanbao connect 在 sign-token 失败时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ code: 401 }),
        text: async () => 'unauthorized',
      })),
    )
    const y = createYuanbaoAdapter()
    await expect(
      y.connect({
        config: { appId: 'k' },
        getSecret: async () => 's',
        bridge: { onStatus: vi.fn(), onMessage: vi.fn() },
        filesDir: '/tmp',
        getWin: () => null,
      } as never),
    ).rejects.toThrow(/sign-token|HTTP|401|AuthBind|WS|failed|失败/i)
    vi.unstubAllGlobals()
  })
})
