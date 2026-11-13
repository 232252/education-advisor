import { describe, expect, it } from 'vitest'
import { dshPluginLinkSpec, dshWebLaunchArgs, parseDshWebAnnouncement } from '../im-url'

describe('parseDshWebAnnouncement', () => {
  it('取出带 token 的根 URL', () => {
    const text = 'booting\ndsh web: http://127.0.0.1:3080/?token=abc\nready\n'
    expect(parseDshWebAnnouncement(text)).toBe('http://127.0.0.1:3080/?token=abc')
  })

  it('丢掉 LAN 后缀，只留本机地址', () => {
    const text =
      'dsh web: http://127.0.0.1:4312/?token=abc (LAN: http://192.168.1.5:4312/?token=abc)'
    expect(parseDshWebAnnouncement(text)).toBe('http://127.0.0.1:4312/?token=abc')
  })

  it('还没打印地址时返回 null', () => {
    expect(parseDshWebAnnouncement('dsh web: opening the default browser')).toBeNull()
  })
})

describe('dshWebLaunchArgs', () => {
  it('把补丁放在 web 应用自己的参数前面，并保持顺序', () => {
    expect(
      dshWebLaunchArgs(['C:/home/hardening.yml', 'C:/home/providers.yml', 'C:/home/mcp.yml']),
    ).toEqual([
      'web',
      '--patch',
      'C:/home/hardening.yml',
      '--patch',
      'C:/home/providers.yml',
      '--patch',
      'C:/home/mcp.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ])
  })
})

describe('dshPluginLinkSpec', () => {
  it('把 Windows 路径写成 pnpm link 说明符', () => {
    expect(dshPluginLinkSpec('C:\\repo\\vendor\\dsh-im')).toBe('link:C:/repo/vendor/dsh-im')
  })
})

// pnpm 启动/镜像源用例已随死代码删除：教师机不带 pnpm、不现场装插件
// （DSH_CORE_RUNTIME.md §3.4），连接中心依赖随包分发、缺失即要求重装。
