// 连接中心嵌进 dsh web 时，收侧栏的样式不能打到官方分段选项卡上。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'vendor/dsh-im/integrations/eaa-panel/client.js'),
  'utf8',
)

describe('eaa-panel 嵌入样式', () => {
  it('只把带侧栏标记的外层框架收成 0 宽', () => {
    expect(source).toContain(
      'div[style*="grid-template-columns"]:is([data-sidebar-collapsed],:has([data-side="sidebar"]))',
    )
    expect(source).toContain('`${frame}{grid-template-columns:0px minmax(0,1fr) 0px !important}`')
    expect(source).not.toContain(':not([role="tablist"])')
    expect(source).not.toContain(
      'div[style*="grid-template-columns"]{grid-template-columns:0px minmax(0,1fr) 0px !important}',
    )
  })

  it('藏掉侧栏拖拽条，避免它盖在 IM 页上', () => {
    expect(source).toContain('[data-side="sidebar"]{display:none !important}')
  })

  it('嵌进来时不提供插件自更新和 GitHub，通用设置仍在', () => {
    expect(source).toContain('max-width:none !important')
    expect(source).toContain('.dim-updateAction{display:none !important}')
    expect(source).toContain('.dim-githubAction{display:none !important}')
    expect(source).not.toContain('.dim-generalSettingsAction{display:none')
  })

  it('窄于官方 840px 断点时频道栏和内容各自留在窗口里', () => {
    expect(source).not.toContain('@media (min-width:841px)')
    expect(source).toContain(
      'html.eaa-im-embed .dim-page{height:100%;max-height:100%;max-width:none !important',
    )
    expect(source).toContain('@media (max-width:840px){')
    expect(source).toContain('grid-template-rows:minmax(0,42%) minmax(0,1fr)')
  })

  it('muteHarnessChrome 只处理外层框架', () => {
    expect(source).toContain(
      'div[style*="grid-template-columns"][data-sidebar-collapsed], div[style*="grid-template-columns"]:has([data-side="sidebar"])',
    )
    expect(source).not.toContain("frame.getAttribute('role') === 'tablist'")
  })
})
