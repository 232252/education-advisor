import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  DSH_WELCOME_NOTICE_VERSION,
  eaaWelcomeNoticePatchRows,
  ensureEaaWelcomeNoticePatch,
} from '../welcome-notice'

const require = createRequire(import.meta.url)

describe('连接中心跳过预览版说明', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('确认版本和当前 dsh 包里的文案版本一致', () => {
    const file = require.resolve('@deepseek-ai/dsh-client-ui-settings-models/package.json')
    const client = join(file, '..', 'lib', 'client.js')
    return readFile(client, 'utf8').then((text) => {
      const match = text.match(/WELCOME_NOTICE_VERSION = "([^"]+)"/)
      expect(match?.[1]).toBe(DSH_WELCOME_NOTICE_VERSION)
    })
  })

  it('补丁只改欢迎说明那一行，不插入新插件', async () => {
    const rows = eaaWelcomeNoticePatchRows()
    expect(rows).toEqual([
      {
        id: 'ui-settings-general',
        config: { welcomeNoticeVersion: DSH_WELCOME_NOTICE_VERSION },
      },
      {
        id: 'ui-settings-models',
        config: { credentialOnboarding: false },
      },
    ])
    dir = await mkdtemp(join(tmpdir(), 'eaa-welcome-'))
    const path = ensureEaaWelcomeNoticePatch(dir)
    expect(parse(await readFile(path, 'utf8'))).toEqual(rows)
    const again = ensureEaaWelcomeNoticePatch(dir)
    expect(again).toBe(path)
  })

  it('已安装设置行上的其它字段保留，只改欢迎说明和凭据引导', () => {
    const rows = eaaWelcomeNoticePatchRows({
      general: { locale: 'zh-CN', welcomeNoticeVersion: 'old' },
      models: { showPricing: true },
    })
    expect(rows[0].config).toEqual({
      locale: 'zh-CN',
      welcomeNoticeVersion: DSH_WELCOME_NOTICE_VERSION,
    })
    expect(rows[1].config).toEqual({ showPricing: true, credentialOnboarding: false })
  })
})
