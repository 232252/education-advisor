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
            // 依赖本机真实 EAA 二进制的 e2e 压力/渲染测试(用户按键流、业务场景、
            // 组件渲染、页面渲染)。它们按"二进制存在则运行"判断,而 Linux 镜像上
            // 的 EAA 二进制在流水线中不可靠,会阻塞发布;这些是本地 dogfood 测试,
            // 发布时跳过,本地 `npm run test` 行为不受影响。mac 因缺 darwin 二进制
            // 本就整组跳过、win 二进制正常,故仅对 Linux 有意义。
            ...(process.env.RELEASE_CI === '1'
              ? [
                  'tests/e2e/user-flow-simulation.test.tsx',
                  'tests/e2e/business-scenario.test.tsx',
                  'tests/e2e/component-render.test.tsx',
                  'tests/e2e/page-render.test.tsx',
                ]
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
    // 文件级并行(2026-09-04 测试提速轮): 全量 317s → 25s。
    // 此前强制串行是防端口/资源冲突 — 复核结论: 各文件临时目录均走
    // mkdtemp(随机后缀)、无固定端口绑定(唯一 PORT 字样是 IPC_EAA_EXPORT
    // 子串误报)、真实 EAA e2e 每文件独立 TEST_ROOT,连续三次全量并行
    // 均绿(190 files/3173 tests)。若个别文件再现资源冲突,局部修复
    // (独立端口/目录)或将该文件标记 test.sequential,不要整体回退串行。
    // 注: vitest 4 中 project 级 fileParallelism 不覆盖顶层值,统一在此声明。
    fileParallelism: true,
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
