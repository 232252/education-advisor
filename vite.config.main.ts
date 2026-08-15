import { defineConfig } from 'vite'
import { resolve } from 'path'

// 主进程 Vite 配置
// 将 TypeScript 编译为 Node.js 可执行的 JS
// 适配 Electron 43 (Node.js 24.18 / Chromium 150)
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
    target: 'node24',
    minify: false,
    // Sourcemaps reference files outside the app dir (../pi/packages/*/dist)
    // which electron-builder's asar check rejects. Disabled for packaging.
    // The CI build with `npm run build` (no electron-builder) keeps sourcemaps
    // via the --sourcemap flag below.
    sourcemap: false,
  },
  ssr: {
    // 主进程 ssr 模式 rollup 默认 external 所有依赖
    // noExternal 强制 rollup 把包内联到 bundle
    // - typebox: 1.x 是 ESM-only (package.json `type: "module"` + 所有 .mjs)，
    //   必须在 CJS 产物中由 rollup 转译
    // - pi-telemetry: exports 仅含 "import" 条件无 "require"/"default"，
    //   CJS 产物运行时 require 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED，必须内联
    noExternal: ['typebox', '@earendil-works/pi-telemetry'],
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      // The @earendil-works/* packages are resolved through node_modules
      // (Junction links to ../pi/packages/*) — we intentionally do NOT
      // alias to ../pi/.../dist/index.js here, because electron-builder's
      // asar packer rejects files outside the app dir.
    },
  },
})
