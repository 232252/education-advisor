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
          if (!id.includes('node_modules')) return
          // React 核心必须最先精确判定: 宽松的 'react/' 子串会误吞 lucide-react
          // 等包名含 react 的库。包名精确匹配,避免子串误路由。
          // 注: markdown 渲染栈(react-markdown/remark/katex ~428KB)不设手动
          // vendor chunk — 其唯一消费者 Markdown.tsx 仅被懒加载页面引用,
          // 自然跟随懒块按需加载;此前手动分包反而被 rolldown 连带 jsx-runtime
          // 一起拖入首屏同步加载。
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          // ECharts 单独打包 — 仅图表页使用,首屏不加载
          if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'vendor-echarts'
          // 图标库(R162 试验): 不再 manualChunks 强制单块 — 原先把仅懒加载
          // 页面使用的图标也拉进 entry 共享块(19KB);交给 rolldown 按引用图
          // 自然分流:仅 entry 组件用的图标进 entry,页面专用图标随页面 chunk
          // 路由 + 状态管理（几乎每个页面都依赖）
          if (id.includes('react-router') || id.includes('zustand')) return 'vendor-app'
          // R136 优化: AI SDK 单独打包 — Chat/Agents 页使用,体积较大
          if (id.includes('@earendil-works') || id.includes('pi-agent') || id.includes('pi-ai')) return 'vendor-ai'
        },
      },
    },
    target: 'chrome150',
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
