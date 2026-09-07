import { defineConfig } from 'vite'
import { resolve } from 'path'

// Preload 独立构建配置
// 为什么与主进程分开: sandboxed preload 的 require 只允许 'electron',
// 相对文件导入(共享 chunk)在沙箱下直接抛错 — 因此 preload 必须
// 单文件内联(唯一 external = electron),这是开启 renderer 沙箱的前提。
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: false,
    lib: {
      entry: { preload: resolve(import.meta.dirname, 'src/main/preload/index.ts') },
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: ['electron'],
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'node24',
    minify: false,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@main': resolve(import.meta.dirname, 'src/main'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
})
