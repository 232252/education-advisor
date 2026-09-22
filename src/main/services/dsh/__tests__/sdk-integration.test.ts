// =============================================================
// dsh SDK 真实装载冒烟测试（默认跳过）
//
// 验证单元测试覆盖不到的那段：CJS 环境下的动态 import 能否解析 ESM-only 的
// dsh-sdk-client，并拉起 dsh 子进程完成 initialize 握手。
//
// 为什么要 spawn 独立 node 进程，而不是在本文件直接 await loadSdkClient()：
// vitest 的 SSR 模块执行器不给 new Function 里的 import() 注入 dynamic import
// 回调，直接调会抛「A dynamic import callback was not specified.」。那是测试
// 运行环境的限制，不是产品路径 —— 生产是 Electron 主进程加载构建出的
// dist/main/index.cjs，与 `node -e` 同属普通 Node CJS 上下文。
//
// 与 eaa 二进制同款约定：依赖缺失即整组跳过，避免 CI 误报；EA_DSH_SMOKE=1
// 且依赖在场时才跑。只握手、不发 prompt，因此不产生 token 消耗。
//
// 跑法: EA_DSH_SMOKE=1 npx vitest run src/main/services/dsh/__tests__/sdk-integration.test.ts
// =============================================================

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadSdkClient } from '../runtime'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const requireFromRoot = createRequire(`${ROOT}/package.json`)

function canResolve(specifier: string): boolean {
  try {
    return existsSync(requireFromRoot.resolve(specifier))
  } catch {
    return false
  }
}

const depsInstalled =
  canResolve('@deepseek-ai/dsh-sdk-client/package.json') &&
  canResolve('@deepseek-ai/dsh/package.json')

const ready = process.env.EA_DSH_SMOKE === '1' && depsInstalled
const skipWhy =
  process.env.EA_DSH_SMOKE === '1'
    ? 'dsh SDK/CLI 未安装于本项目 node_modules'
    : '未设 EA_DSH_SMOKE=1'

/** 与 runtime.ts 的 loadSdkClient 同形：new Function 让打包器看不到 specifier */
const PROBE_SCRIPT = `
const dynamicImport = new Function('specifier', 'return import(specifier)')
const root = ${JSON.stringify(ROOT)}
dynamicImport('@deepseek-ai/dsh-sdk-client')
  .then(async (mod) => {
    const client = new mod.HarnessClient({ processCwd: root })
    const res = await client.initialize({
      cwd: root,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    process.stdout.write(JSON.stringify(res.serverInfo))
    await client.close().catch(() => {})
  })
  .catch((err) => {
    process.stderr.write(String((err && err.stack) || err))
    process.exitCode = 1
  })
`

describe.skipIf(!ready)(`dsh SDK 冒烟（跳过条件：${skipWhy}）`, () => {
  it('普通 Node CJS 上下文可解析 ESM-only SDK 并完成 initialize 握手', () => {
    const run = spawnSync(process.execPath, ['-e', PROBE_SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 170_000,
    })
    expect(run.status, `stderr: ${run.stderr}`).toBe(0)
    expect(JSON.parse(run.stdout.trim())).toEqual({
      name: 'deepseek-harness-sdk-runtime',
      version: expect.any(String),
    })
  }, 180_000)
})

// 与上面的门控相反：这条恒跑，用来钉住「vitest 里不能直接调 loadSdkClient」这件事。
// 若哪天有人把 new Function 当成可疑代码改掉，构建出的 CJS 主进程会立刻加载不了
// ESM-only 的 SDK，而 vitest 里反而「通过」——这个断言就是防这个反直觉陷阱。
describe('loadSdkClient 的执行环境边界', () => {
  it('vitest SSR 执行器不提供 dynamic import 回调（故产品验证须走子进程）', async () => {
    await expect(loadSdkClient()).rejects.toThrow(/dynamic import callback/i)
  })
})
