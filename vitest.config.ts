// =============================================================
// Vitest 配置（P2-5）
// - 渲染进程 hook 测试：jsdom 环境
// - 主进程 service 测试：node 环境（tests/main/**）
// - 共享 setup: 静默 console / stub electron
// =============================================================
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // 注意: Vitest 4 的 projects 模式不会继承顶层 resolve.alias,
  // 别名必须在每个 project 内重复声明(否则 @shared/* 等值导入在测试中解析失败)。
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
    exclude: [
      'node_modules',
      'dist',
      'release',
      '**/*.d.ts',
      // 10 分钟持续压力测试，仅按需单独运行（npm run test:stress），
      // 不进入默认 `npm test`，避免拖慢日常回归。
      'tests/e2e/stress-long.test.tsx',
    ],
    // 用 projects 区分 renderer (jsdom) 和 main (node)
    projects: [
      {
        // 渲染进程 hook 测试
        resolve: {
          alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared'),
          },
        },
        test: {
          name: 'renderer',
          globals: true,
          include: [
            'src/renderer/**/*.{test,spec}.{ts,tsx}',
            'tests/renderer/**/*.{test,spec}.{ts,tsx}',
          ],
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 30_000,
        },
      },
      {
        // 主进程 service + shared 测试
        resolve: {
          alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared'),
          },
        },
        test: {
          name: 'main',
          globals: true,
          include: [
            'src/main/**/*.{test,spec}.{ts,tsx}',
            'tests/main/**/*.{test,spec}.{ts,tsx}',
            'tests/shared/**/*.{test,spec}.{ts,tsx}',
            'tests/e2e/**/*.{test,spec}.{ts,tsx}',
          ],
          exclude: [
            'tests/e2e/stress-long.test.tsx',
            // 重度 UI 压力测试(用户按键流模拟)依赖本机真实 EAA 二进制,
            // 在 release 流水线(尤其无二进制落盘的 Linux)上不稳定,用于本地 dogfood;
            // 发布时跳过,本地 `npm run test` 行为不受影响。
            ...(process.env.RELEASE_CI === '1'
              ? ['tests/e2e/user-flow-simulation.test.tsx']
              : []),
          ],
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 60_000,
        },
      },
    ],
    // 60s 默认超时
    testTimeout: 60_000,
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
