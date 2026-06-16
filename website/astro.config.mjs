import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import tailwind from '@astrojs/tailwind'
import sitemap from '@astrojs/sitemap'

// =============================================================
// Education Advisor 官网 — Astro 配置
//
// Starlight 0.34 配置: 顶层键为 title/description/logo/social/sidebar/
// customCss/editLink/favicon/pagefind/routeMiddleware/markdown
// (无 repository/defaultTheme; 主题切换由 Starlight 内置组件处理)
// =============================================================

export default defineConfig({
  site: 'https://eea.qdzwwqd.top',
  output: 'static',

  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),

    starlight({
      title: 'Education Advisor',
      description: '18-Agent 班主任操行分管理系统 · Tauri + Rust',

      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },

      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/232252/education-advisor' },
      ],

      // "编辑此页" 链接 → GitHub 文档源码
      editLink: {
        baseUrl: 'https://github.com/232252/education-advisor/edit/main/website/src/content/docs',
      },

      customCss: [
        './src/styles/tailwind.css',
        './src/styles/starlight-overrides.css',
      ],

      sidebar: [
        {
          label: '开始',
          items: [
            { label: '简介', slug: 'intro' },
            { label: '极速上手', slug: 'quick-start' },
            { label: '安装指南', slug: 'installation' },
          ],
        },
        {
          label: '架构与原理',
          items: [
            { label: '架构说明', slug: 'architecture' },
            { label: '隐私引擎', slug: 'privacy_engine' },
            { label: '数据引擎桥接', slug: 'eaa_bridge' },
            { label: '定时调度', slug: 'cron' },
            { label: 'Agent 编写', slug: 'agent_authoring' },
          ],
        },
        {
          label: '开发与部署',
          items: [
            { label: '开发指南', slug: 'development' },
            { label: '桌面端构建', slug: 'desktop_build' },
            { label: '分发打包', slug: 'distribution' },
            { label: '配置项', slug: 'configuration' },
          ],
        },
        {
          label: '帮助',
          items: [
            { label: '常见问题', slug: 'faq' },
            { label: '问题排查', slug: 'troubleshooting' },
          ],
        },
      ],

      pagefind: true, // 内置静态搜索 (零延迟, 浏览器本地)
    }),

    sitemap({
      filter: (page) => !page.includes('/draft/'),
    }),
  ],

  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'one-dark-pro',
      },
      wrap: true,
    },
  },

  vite: {
    build: {
      cssCodeSplit: true,
      chunkSizeWarningLimit: 100,
    },
  },
})
