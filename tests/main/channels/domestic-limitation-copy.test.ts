import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { qqManifest } from '../../../src/main/services/channels/adapters/qq/manifest'
import { weixinManifest } from '../../../src/main/services/channels/adapters/weixin/manifest'

describe('domestic limitation copy', () => {
  it('zh/en 字典含 QQ/微信限制文案', () => {
    const zh = JSON.parse(readFileSync(resolve('src/renderer/i18n/zh.json'), 'utf8')) as Record<
      string,
      string
    >
    const en = JSON.parse(readFileSync(resolve('src/renderer/i18n/en.json'), 'utf8')) as Record<
      string,
      string
    >
    expect(zh[qqManifest.limitationBannerKey!]).toMatch(/配额|主动/)
    expect(zh[weixinManifest.limitationBannerKey!]).toMatch(/私聊|主动/)
    expect(en[qqManifest.limitationBannerKey!].length).toBeGreaterThan(20)
    expect(en[weixinManifest.limitationBannerKey!].length).toBeGreaterThan(20)
  })
})
