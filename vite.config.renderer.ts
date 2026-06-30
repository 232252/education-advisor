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
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
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
