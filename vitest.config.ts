// =============================================================
// Vitest 配置
// - 渲染进程 hook/store 测试：jsdom 环境
// - 共享 setup: 静默 console / stub @tauri-apps/api
//
// v0.2.0: 仓库已无 Electron 主进程 (src/main/ 已封存), 只剩渲染端单测。
// =============================================================
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    globals: true,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', 'release', 'archive', '**/*.d.ts'],
    // 渲染进程测试统一在 jsdom 环境
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // 30s 默认超时（CI 友好）
    testTimeout: 30_000,
    // 不在 CI 中跑并发时强制串行,避免端口/资源冲突
    fileParallelism: false,
    // 报告:verbose 让通过/失败一目了然
    reporters: process.env.CI ? ['default'] : ['verbose'],
    // coverage 配置（按需启用,不在 vitest run 默认跑）
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
      ],
    },
  },
})

