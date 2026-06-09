import { defineConfig } from 'vite'
import { resolve } from 'path'

// 主进程 Vite 配置
// 将 TypeScript 编译为 Node.js 可执行的 JS
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/main',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/main/index.ts'),
        preload: resolve(__dirname, 'src/main/preload/index.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'node-cron',
        'chokidar',
        'cross-spawn',
      ],
    },
    target: 'node22',
    minify: false,
    sourcemap: true,
  },
  ssr: {
    // 主进程 ssr 模式 rollup 默认 external 所有依赖
    // noExternal 强制 rollup 把包内联到 bundle
    // - typebox: 1.x 是 ESM-only (package.json `type: "module"` + 所有 .mjs)，
    //   必须在 CJS 产物中由 rollup 转译
    // - @earendil-works/pi-ai / pi-agent-core 通过下方 resolve.alias 解析到
    //   ../pi/packages/*/dist/index.js (绝对路径)，rollup 看到绝对路径会
    //   直接读取文件而不会 external，无需 noExternal
    noExternal: ['typebox'],
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@earendil-works/pi-ai': resolve(__dirname, '../pi/packages/ai/dist/index.js'),
      '@earendil-works/pi-agent-core': resolve(__dirname, '../pi/packages/agent/dist/index.js'),
    },
  },
})
