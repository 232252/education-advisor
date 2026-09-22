#!/usr/bin/env node
// =============================================================
// scripts/verify-dsh-package.mjs
//
// dsh 后端的「装配可启动性」门禁。
//
// 为什么单独立一个脚本：dsh 是缺省后端，但整套测试都是打桩的假客户端，
// 所以「SDK 没装 / 装成了 devDependency / 没随包解出真实文件」这类问题
// **测试一个都抓不到**，而它们的症状是装了出来的 app 每次 AI 调用都失败。
//
// 检查项：
//  1. @deepseek-ai/dsh-sdk-client 在 dependencies（devDependencies 里打包态必死）
//  2. 已安装的 sdk-client 带运行时依赖 @deepseek-ai/dsh，且版本与已装的一致
//  3. dsh 的可执行入口在真实磁盘上存在
//  4. electron-builder 的 asarUnpack 覆盖 node_modules（纯 node 子进程看不见 app.asar）
//  5. 可选 --dist <win-unpacked>：核对打包产物里入口确实落在 app.asar.unpacked 下
//
// 用法: npm run verify:dsh [-- --dist release/win-unpacked]
// 退出码: 0 全部通过 / 1 有失败项
// =============================================================

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = '@deepseek-ai/dsh-sdk-client'
const RUNTIME = '@deepseek-ai/dsh'

const failures = []
const checks = []
function check(ok, label, detail = '') {
  checks.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const pkg = readJson(join(ROOT, 'package.json'))
const deps = pkg.dependencies ?? {}
const devDeps = pkg.devDependencies ?? {}

check(
  Boolean(deps[SDK]) && !devDeps[SDK],
  `${SDK} 是 dependencies 条目`,
  deps[SDK] ? `声明版本 ${deps[SDK]}` : devDeps[SDK] ? '被挪到了 devDependencies(打包态会缺)' : '未声明',
)

let sdkManifest = null
try {
  sdkManifest = readJson(join(ROOT, 'node_modules', SDK, 'package.json'))
} catch {
  check(false, `${SDK} 已安装到 node_modules`, 'require 不到它的 package.json')
}
if (sdkManifest) {
  const want = sdkManifest.dependencies?.[RUNTIME]
  check(Boolean(want), `已装 SDK 声明运行时依赖 ${RUNTIME}`, want ?? '未声明(子进程无从启动)')
  let installed = null
  try {
    installed = readJson(join(ROOT, 'node_modules', RUNTIME, 'package.json'))
  } catch {
    check(false, `${RUNTIME} 已安装到 node_modules`)
  }
  if (installed) {
    check(
      !want || want === installed.version,
      'SDK 与 dsh 运行时版本一致',
      `SDK 要 ${want}，实装 ${installed.version}`,
    )
    const binField = installed.bin
    const binRel = typeof binField === 'object' && binField ? binField.dsh : binField
    check(Boolean(binRel), `${RUNTIME} 声明了 dsh 可执行入口`, String(binField ?? '无 bin 字段'))
    if (binRel) {
      const entry = join(ROOT, 'node_modules', RUNTIME, binRel)
      check(existsSync(entry), 'dsh 入口在真实磁盘上存在', entry)
      verifyDist(entry, binRel)
    }
  }
}

const builderYml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
check(
  /^\s*-\s*["']?\*\*\/node_modules\/\*\*/m.test(builderYml),
  'asarUnpack 覆盖整棵 node_modules',
  '缺少 "**/node_modules/**"：纯 node 子进程读不到 app.asar 内的入口',
)

function verifyDist(entry, binRel) {
  const at = process.argv.indexOf('--dist')
  if (at < 0) return
  const dist = resolve(process.argv[at + 1] || '')
  const unpacked = join(dist, 'resources', 'app.asar.unpacked', 'node_modules', RUNTIME, binRel)
  check(existsSync(unpacked), '打包产物内 dsh 入口已解出为真实文件', unpacked)
}

console.log(`verify-dsh-package: ${checks.length - failures.length}/${checks.length} 通过`)
for (const line of checks) if (line.startsWith('FAIL')) console.log('  ' + line)
if (failures.length) {
  console.error(`\ndsh 装配门禁失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
