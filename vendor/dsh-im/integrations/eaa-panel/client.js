// 教育参谋把 dsh web 嵌进连接中心。官方 desktop-panel 只在 iframe 里启用
// （window.parent !== window），WebContentsView 是顶层页面，所以这里自己挂一次。
// 官方面板要大约 840px 才保持左右分栏；dsh 自己的会话侧栏会再吃掉一列，嵌进来时收掉。
window.__ModuleLoader__.load({
  id: 'eaa-dsh-im-panel',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'dsh-im'
    const EMBED_STYLE_ID = 'eaa-dsh-im-embed'

    function Icon(props) {
      const size = props.size || 18
      return h(
        'svg',
        {
          ...props,
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9.2 9.2 0 0 1-4-.9L3 21l1.9-5.5a9.2 9.2 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z',
        }),
        h('path', { d: 'M8 11.5h.01M12 11.5h.01M16 11.5h.01' }),
      )
    }

    function installEmbedStyle() {
      if (document.getElementById(EMBED_STYLE_ID)) return
      const tag = document.createElement('style')
      tag.id = EMBED_STYLE_ID
      // 框架第一列是会话侧栏。不能 display:none，否则它退出网格，
      // 中间的 IM 面板会掉进 0 宽的第一列。只把这一列收成 0，面板留在第二列。
      // 只打在带侧栏标记的外层框架上。官方分段选项卡和诊断详情也用网格，
      // 打宽了会把选项或字段压成 0 宽。
      // 页面始终锁在这块视图的高度里。标题行不再留空边。
      // 宽屏时频道栏和右侧各自滚动。窄于官方 840px 断点时改成上下排列，
      // 频道栏最多占四成并自己滚，二维码留在下面，不会被整页裁掉。
      const frame =
        'html.eaa-im-embed div[style*="grid-template-columns"]:is([data-sidebar-collapsed],:has([data-side="sidebar"]))'
      tag.textContent = [
        `${frame}{grid-template-columns:0px minmax(0,1fr) 0px !important}`,
        `${frame}>div:first-child{visibility:hidden !important;overflow:hidden !important;min-width:0 !important;pointer-events:none !important}`,
        'html.eaa-im-embed [data-side="sidebar"]{display:none !important}',
        'html.eaa-im-embed [data-shell-leading]{visibility:hidden !important}',
        'html.eaa-im-embed .dim-brand{display:none !important}',
        'html.eaa-im-embed .dim-updateAction{display:none !important}',
        'html.eaa-im-embed .dim-githubAction{display:none !important}',
        'html.eaa-im-embed .dim-title{margin:0 !important;justify-content:flex-end !important}',
        'html.eaa-im-embed .dim-page{height:100%;max-height:100%;max-width:none !important;width:100%;overflow:hidden;display:flex;flex-direction:column;padding:0 !important}',
        'html.eaa-im-embed .dim-layout{flex:1 1 auto;min-height:0;align-items:stretch;overflow:hidden}',
        'html.eaa-im-embed .dim-rail,html.eaa-im-embed .dim-panel{min-height:0;overflow:auto}',
        '@media (max-width:840px){',
        'html.eaa-im-embed .dim-layout{grid-template-rows:minmax(0,42%) minmax(0,1fr)}',
        '}',
      ].join('')
      document.head.appendChild(tag)
      document.documentElement.classList.add('eaa-im-embed')
    }

    function removeEmbedStyle() {
      document.documentElement.classList.remove('eaa-im-embed')
      document.getElementById(EMBED_STYLE_ID)?.remove()
    }

    // 宽屏时侧栏默认展开（约 280px）。嵌进来只需要 IM 面板，展开就收一次。
    function collapseHarnessSidebar(ctx) {
      muteHarnessChrome()
      if (window.innerWidth < 1024) return
      if (document.querySelector('[data-sidebar-collapsed]')) return
      try {
        ctx.layout.toggleSidebar()
      } catch {
        // layout 还没挂上
      }
    }

    // 样式把侧栏收成 0 宽，但节点还在。inert 只打在外层框架的第一列上，
    // 不碰官方分段选项卡和诊断详情里的网格。
    function muteHarnessChrome() {
      const frames = document.querySelectorAll(
        'div[style*="grid-template-columns"][data-sidebar-collapsed], div[style*="grid-template-columns"]:has([data-side="sidebar"])',
      )
      for (const frame of frames) {
        const side = frame.querySelector(':scope > div')
        if (!side) continue
        side.setAttribute('aria-hidden', 'true')
        side.inert = true
      }
    }

    return {
      name: 'eaa-dsh-im-panel',
      inject: ['slots', 'layout', 'locale', 'dshImClient'],
      apply(ctx) {
        if (!ctx.dshImClient || ctx.dshImClient.version !== 1) return
        const im = ctx.dshImClient
        const t = ctx.locale.bind('dsh-im')

        function Panel() {
      // 官方 .dim-pluginPage 自己有内边距。再套一层会把频道栏和二维码挤小。
          return h(
            'div',
            {
              style: {
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
                boxSizing: 'border-box',
              },
            },
            im.render({ preferredSectionId: 'feishu' }),
          )
        }

        return ctx.slots.inject('main', () => {
          installEmbedStyle()
          const stopMain = ctx.slots.register(
            { name: 'main', key: PANEL_ID, locale: 'dsh-im' },
            Panel,
          )
          const stopSide = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 0,
                locale: 'dsh-im',
                label: () => t('IM机器人'),
              },
              Icon,
            ),
          )
          let tries = 0
          let revealed = false
          const reveal = () => {
            if (typeof ctx.layout.hasMainPanel === 'function' && !ctx.layout.hasMainPanel(PANEL_ID)) {
              return false
            }
            ctx.layout.selectPanel(PANEL_ID)
            collapseHarnessSidebar(ctx)
            if (!revealed) {
              revealed = true
              // 新入口和内容都在了再藏设置里的重复入口。失败就留着，教师还能从设置打开。
              im.setSettingsVisible(false)
            }
            return true
          }
          const timer = setInterval(() => {
            tries += 1
            try {
              if (reveal()) clearInterval(timer)
              else if (tries > 40) clearInterval(timer)
            } catch {
              if (tries > 40) clearInterval(timer)
            }
          }, 50)
          const onResize = () => collapseHarnessSidebar(ctx)
          window.addEventListener('resize', onResize)
          return () => {
            clearInterval(timer)
            window.removeEventListener('resize', onResize)
            im.setSettingsVisible(true)
            removeEmbedStyle()
            stopSide()
            stopMain()
          }
        })
      },
    }
  },
})
