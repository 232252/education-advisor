import { defineConfig } from 'vite'
import { resolve } from 'path'

// 主进程 Vite 配置
// 将 TypeScript 编译为 Node.js 可执行的 JS
// 适配 Electron 45 (Node.js 24.22 / Chromium 156)
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/main',
    // 与 preload 共用 dist/main。清空目录会删掉 preload.cjs，窗口直接起不来。
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/main/index.ts'),
        // preload 移至 vite.config.preload.ts 独立单文件内联构建
        // (sandboxed preload 的 require 只允许 'electron',不能有共享 chunk)
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'node-cron',
        'cross-spawn',
        'ws',
        'selfsigned',
        // PDF 栅格化运行时依赖(ssr 模式默认已 external,此处显式声明意图):
        // pdfjs-dist 子路径(legacy/build/pdf.mjs)经动态 import 引入
        /^pdfjs-dist(\/|$)/,
        /^@napi-rs\/canvas(\/|$)/,
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
    // - @earendil-works/* (chord / pi-telemetry / pi-ai …): exports 只有
    //   "import" 没有 "require"/"default"。CJS 主进程 `require("@earendil-works/chord/context")`
    //   会抛 ERR_PACKAGE_PATH_NOT_EXPORTED，安装包启动只剩 Error 对话框。
    noExternal: [
      'typebox',
      /^@earendil-works\//,
      // pi-ai 0.87 的代理 Agent 是 ESM 9.x，仓库里其它包仍用能被 require 的 7.x。
      // 打进主进程包，避免运行时解析到旧版本。
      'http-proxy-agent',
      'https-proxy-agent',
      'agent-base',
    ],
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
