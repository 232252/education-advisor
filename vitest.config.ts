// =============================================================
// Vitest 配置（P2-5）
// - 渲染进程 hook 测试：jsdom 环境
// - 主进程 service 测试：node 环境（tests/main/**）
// - 共享 setup: 静默 console / stub electron
// =============================================================
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
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
    exclude: ['node_modules', 'dist', 'release', '**/*.d.ts'],
    // 用 projects 区分 renderer (jsdom) 和 main (node)
    projects: [
      {
        // 渲染进程 hook 测试
        test: {
          name: 'renderer',
          globals: true,
          include: [
            'src/renderer/**/*.{test,spec}.{ts,tsx}',
            'tests/renderer/**/*.{test,spec}.{ts,tsx}',
          ],
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        // 主进程 service + shared 测试
        test: {
          name: 'main',
          globals: true,
          include: [
            'src/main/**/*.{test,spec}.{ts,tsx}',
            'tests/main/**/*.{test,spec}.{ts,tsx}',
            'tests/shared/**/*.{test,spec}.{ts,tsx}',
            'tests/e2e/**/*.{test,spec}.{ts,tsx}',
          ],
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
        },
      },
    ],
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
