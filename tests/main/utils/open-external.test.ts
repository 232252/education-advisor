// =============================================================
// openExternalUrl 白名单测试 — https/mailto 放行,其余协议与非法 URL 拒绝
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from '../../../src/main/utils/open-external'

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }))

vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal },
  app: { getPath: vi.fn(() => '/tmp/ea-open-external-test') },
}))

describe('openExternalUrl', () => {
  beforeEach(() => mocks.openExternal.mockClear())

  it('放行 https 链接', async () => {
    await openExternalUrl('https://github.com/x/y/releases/tag/v1')
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/x/y/releases/tag/v1')
  })

  it('放行 mailto 链接', async () => {
    await openExternalUrl('mailto:support@example.com')
    expect(mocks.openExternal).toHaveBeenCalledWith('mailto:support@example.com')
  })

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'smb://host/share',
    'data:text/html,<script>x</script>',
    'http://insecure.example.com/path',
  ])('拒绝白名单外协议 %s', async (url) => {
    await openExternalUrl(url)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('非法 URL 不抛错且拒绝(调用点无需包 try)', async () => {
    await expect(openExternalUrl('not a url at all')).resolves.toBeUndefined()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
