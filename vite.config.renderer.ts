import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 渲染进程 Vite 配置
// React SPA + HMR 开发服务器
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    // RISK 修复: outDir 不在 project root 内,vite 默认不会 empty
    // 显式开启 emptyOutDir 避免多次构建后旧 index-*.js 残留污染 dist
    emptyOutDir: true,
    cssCodeSplit: true,
    // R136 优化: 阈值从 600 降到 400,提前暴露 bundle 体积回退
    // (原 600 KB 阈值过宽松, Chat 等路由 500 KB 也静默通过)
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks(id: string) {
          // ECharts 单独打包 — 仅 Dashboard/StudentProfile 使用
          if (id.includes('echarts') || id.includes('zrender')) return 'vendor-echarts'
          // Markdown 渲染库 — 仅 Chat 页面使用
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('unified') || id.includes('hast-') || id.includes('mdast-')) return 'vendor-markdown'
          // React 核心
          if (id.includes('react-dom') || id.includes('react/') || id.includes('scheduler')) return 'vendor-react'
          // 路由 + 状态管理（几乎每个页面都依赖）
          if (id.includes('react-router') || id.includes('zustand')) return 'vendor-app'
          // R136 优化: AI SDK 单独打包 — Chat/Agents 页使用,体积较大
          if (id.includes('@earendil-works') || id.includes('pi-agent') || id.includes('pi-ai')) return 'vendor-ai'
        },
      },
    },
    target: 'chrome130',
    // See vite.config.main.ts for why sourcemap is disabled here.
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
