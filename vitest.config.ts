// =============================================================
// Vitest 配置（P2-5）
// - 渲染进程 hook 测试：jsdom 环境
// - 主进程 service 测试：node 环境（tests/main/**）
// - 共享 setup: 静默 console / stub electron
// =============================================================
import { defineConfig } from 'vitest/config'
import path from 'node:path'

// stress-long(10 分钟压力测试)仅在 EA_STRESS=1 时纳入(npm run test:stress)。
// 注意 vitest 4 的 CLI 文件过滤器不高于 exclude——单纯 `vitest run <该文件>`
// 会因命中 exclude 而 0 收集,所以 test:stress 必须带 EA_STRESS=1。
const EXCLUDE_STRESS = process.env.EA_STRESS !== '1'
const STRESS_FILE = 'tests/e2e/stress-long.test.tsx'

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
      ...(EXCLUDE_STRESS ? [STRESS_FILE] : []),
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
        ssr: {
          external: ['selfsigned', 'node-forge', 'ws'],
        },
        test: {
          name: 'main',
          globals: true,
          server: {
            deps: {
              external: ['selfsigned', 'node-forge', 'ws'],
            },
          },
          include: [
            'src/main/**/*.{test,spec}.{ts,tsx}',
            'tests/main/**/*.{test,spec}.{ts,tsx}',
            'tests/shared/**/*.{test,spec}.{ts,tsx}',
            'tests/e2e/**/*.{test,spec}.{ts,tsx}',
          ],
          exclude: [
            ...(EXCLUDE_STRESS ? [STRESS_FILE] : []),
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
    // 报告: 默认 default(每文件一行,全量 ~300 行);verbose 每测试一行,
    // 全量 4200+ 测试 ≈ 1MB 输出,会超自动化跑批的输出上限 — 想看逐测试
    // 明细用 VITEST_VERBOSE=1 npm test 显式开启。
    reporters: process.env.VITEST_VERBOSE === '1' ? ['verbose'] : ['default'],
    // 'passed-only': 通过测试的 console 输出一律静默(全量 490+ 块 stdout
    // 噪音 ≈ 200KB,把 default reporter 的输出顶到 256KB 跑批上限边缘);
    // 失败测试的日志保留,排查失败不缺现场。类型缺口: vitest 4 运行时
    // 支持 'passed-only'(见 dist/chunks/index.*.js silent 处理),d.ts 仍
    // 标 boolean,此处断言 bridging。
    silent: 'passed-only' as boolean,
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
