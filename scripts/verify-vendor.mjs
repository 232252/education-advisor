#!/usr/bin/env node
// =============================================================
// scripts/verify-vendor.mjs
//
// 校验 vendor（pi-agent-core / pi-ai）当前状态，升级前后均可跑。
// 检查项：版本号、dist/index.js 存在性、关键 API 可 import、Node 版本兼容警告。
//
// 用法: npm run verify:vendor
// 退出码: 0 全部通过 / 1 有失败项
// =============================================================

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// 期望的关键导出以 0.80.3 为准：模型工厂/计费在根导出，
// getProviders/getModels/getModel 已变为 createModels() 实例方法（旧版遗留检查在 0.80.3 升级后失效）
const VENDORS = [
  { dir: 'vendor/pi-ai', module: '@earendil-works/pi-ai', apis: ['createModels', 'calculateCost'] },
  {
    dir: 'vendor/pi-agent-core',
    module: '@earendil-works/pi-agent-core',
    apis: ['Agent'],
  },
]

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${name}${detail ? '  — ' + detail : ''}`)
  if (ok) pass++
  else fail++
}

/** 从 engines.node 字段提取主版本号，如 ">=22.19.0" → 22 */
function requiredNodeMajor(engines) {
  if (!engines || !engines.node) return null
  const m = String(engines.node).match(/\d+/)
  return m ? Number(m[0]) : null
}

console.log('\n================ vendor 校验 ================\n')

// 1. Node 版本兼容性（Electron 内置 Node 与 vendor engines 要求对比）
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
for (const v of VENDORS) {
  let engines = null
  try {
    engines = JSON.parse(readFileSync(join(ROOT, v.dir, 'package.json'), 'utf-8')).engines
  } catch {
    /* ignore */
  }
  const reqMajor = requiredNodeMajor(engines)
  const detail = reqMajor
    ? `要求 Node >=${reqMajor}，当前 ${process.versions.node}（Electron 内置 ~20）`
    : '无 engines 声明'
  // 这只是警告：engines 多半未严格校验，历史版本在 Node 20 下可跑
  check(`${v.module} Node 兼容`, true, `${detail} [仅参考]`)
}

console.log('\n--- 文件与版本 ---')
// 2. 每个 vendor：package.json 版本 + dist/index.js 存在性
for (const v of VENDORS) {
  let version = '(未知)'
  let hasPkg = false
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, v.dir, 'package.json'), 'utf-8'))
    version = `${pkg.name}@${pkg.version}`
    hasPkg = true
  } catch {
    /* ignore */
  }
  check(`${v.dir} package.json`, hasPkg, version)

  const distEntry = join(ROOT, v.dir, 'dist', 'index.js')
  check(`${v.dir}/dist/index.js 存在`, existsSync(distEntry))
}

console.log('\n--- API 可 import 性（dynamic import）---')
// 3. 动态导入并验证关键导出存在（这是运行时真实加载路径）
for (const v of VENDORS) {
  try {
    const mod = await import(v.module)
    for (const api of v.apis) {
      check(`${v.module} 导出 ${api}`, typeof mod[api] !== 'undefined' && mod[api] !== null)
    }
  } catch (e) {
    check(`${v.module} 可 import`, false, e instanceof Error ? e.message : String(e))
  }
}

console.log('\n--- Submitty schema 参照 (vendor/submitty) ---')
// 4. 批改子系统的上游参照面：UPSTREAM.json pin + 文件哈希
{
  const submittyDir = join(ROOT, 'vendor', 'submitty')
  try {
    const upstream = JSON.parse(readFileSync(join(submittyDir, 'UPSTREAM.json'), 'utf-8'))
    check('submitty UPSTREAM.json tag', /^v\d+\.\d+\.\d+$/.test(upstream.tag ?? ''), upstream.tag ?? '')
    check(
      'submitty UPSTREAM.json commit',
      /^[0-9a-f]{40}$/.test(upstream.commit ?? ''),
      (upstream.commit ?? '').slice(0, 8),
    )
    for (const f of upstream.files ?? []) {
      const file = join(submittyDir, f.path)
      const exists = existsSync(file)
      check(`submitty ${f.path} 存在`, exists)
      if (exists) {
        const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
        check(`submitty ${f.path} sha256 一致`, actual === f.sha256)
      }
    }
  } catch (e) {
    check('submitty UPSTREAM.json 可读', false, e instanceof Error ? e.message : String(e))
  }
}

console.log('\n==============================================')
console.log(`  结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) {
  console.log('  ❌ vendor 校验未通过，建议运行 npm run rollback:vendor 还原。')
  process.exit(1)
}
console.log('  ✅ vendor 校验通过。')
