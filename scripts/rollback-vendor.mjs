#!/usr/bin/env node
// =============================================================
// scripts/rollback-vendor.mjs
//
// 一键回滚 vendor（pi-agent-core / pi-ai）到指定还原点。
// 默认还原到 pre-vendor-upgrade tag（0.75.5 可用状态）。
//
// 用法:
//   npm run rollback:vendor              # 还原到 pre-vendor-upgrade tag
//   npm run rollback:vendor -- --to <ref>  # 还原到任意 commit/tag/分支
//
// 步骤（任一步失败即中止）:
//   1. git checkout <ref> -- vendor/pi-agent-core vendor/pi-ai
//      （仅还原 vendor 两个目录，不动当前分支的其他文件）
//   2. npm install                        （重建 node_modules 符号链接/补依赖）
//   3. npm run build                      （重新编译，确保 dist 一致）
//   4. 打印还原后版本号确认成功
//
// 退出码: 0 成功 / 1 失败
// =============================================================

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const VENDOR_DIRS = ['vendor/pi-agent-core', 'vendor/pi-ai']

function log(level, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [rollback:${level}] ${msg}`)
}
const info = (m) => log('info', m)
const error = (m) => log('error', m)

/** 解析 --to 参数，默认 pre-vendor-upgrade */
function parseArgs(argv) {
  const toIdx = argv.indexOf('--to')
  if (toIdx !== -1 && argv[toIdx + 1]) return argv[toIdx + 1]
  return 'pre-vendor-upgrade'
}

/**
 * 同步执行命令，失败则中止整个脚本。
 * @param {string} label 人类可读步骤名（用于日志）
 * @param {string} cmd 命令
 * @param {string[]} args 参数
 * @param {object} opts spawnSync 选项
 */
function runStep(label, cmd, args, opts = {}) {
  info(`${label}: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  if (result.status !== 0) {
    error(`${label} 失败 (exit ${result.status})`)
    process.exit(1)
  }
}

function readPkgVersion(pkgDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, pkgDir, 'package.json'), 'utf-8'))
    return `${pkg.name}@${pkg.version}`
  } catch (e) {
    return `(读取版本失败: ${e.message})`
  }
}

// ---- 主流程 ----
const targetRef = parseArgs(process.argv.slice(2))
info(`回滚目标: ${targetRef}`)
info(`工作目录: ${ROOT}`)

// 0. 前置检查：确认目标 ref 存在
{
  const check = spawnSync('git', ['rev-parse', '--verify', targetRef], {
    cwd: ROOT,
    shell: process.platform === 'win32',
    encoding: 'utf-8',
  })
  if (check.status !== 0) {
    error(`目标引用 "${targetRef}" 不存在。可用引用: pre-vendor-upgrade / 任意 commit/tag`)
    process.exit(1)
  }
}

// 1. 还原 vendor 目录到目标 ref（仅这两个目录，不影响其他改动）
runStep(
  `还原 vendor 目录到 ${targetRef}`,
  'git',
  ['checkout', targetRef, '--', ...VENDOR_DIRS],
  { cwd: ROOT },
)

// 2. 重装依赖（重建符号链接、补齐 vendor/*/node_modules）
runStep('重装依赖 (npm install)', 'npm', ['install'], { cwd: ROOT })

// 3. 重新编译（确保 dist/ 与还原后的 vendor 一致）
runStep('重新编译 (npm run build)', 'npm', ['run', 'build'], { cwd: ROOT })

// 4. 打印还原后版本，确认成功
info('──────── 还原后 vendor 版本 ────────')
for (const dir of VENDOR_DIRS) {
  console.log(`  ${dir}  →  ${readPkgVersion(dir)}`)
}
info('回滚完成 ✅  当前 vendor 已还原到可靠状态。')
info('提示: 如需查看改动, 运行 `git status` / `git diff`。')
