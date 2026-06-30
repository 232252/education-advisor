#!/usr/bin/env node
// =============================================================
// scripts/prebuild-check.mjs
//
// 构建前置检查：确保 EAA 二进制、agents/、config/ 等核心资源就绪。
// 作为 `prebuild` 钩子调用，任何关键资源缺失都会中止构建。
//
// 退出码:
//   0  所有检查通过
//   1  关键资源缺失且无法自动修复
//   2  平台不支持
// =============================================================

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function log(level, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [prebuild:${level}] ${msg}`)
}
const info = (m) => log('info', m)
const warn = (m) => log('warn', m)
const error = (m) => log('error', m)

// ---- 平台检测 ----
function detectPlatform() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'win32', freebsd: 'freebsd' }
  const archMap = { x64: 'x64', arm64: 'arm64', ia32: 'ia32', arm: 'arm' }
  const p = platformMap[process.platform]
  const a = archMap[process.arch]
  if (!p || !a) {
    error(`Unsupported platform: ${process.platform}/${process.arch}`)
    process.exit(2)
  }
  return `${p}-${a}`
}

const PLATFORM = detectPlatform()
const BINARY_NAME = process.platform === 'win32' ? 'eaa.exe' : 'eaa'

// ---- 关键资源检查 ----
const checks = [
  {
    name: 'EAA 二进制',
    path: join(ROOT, 'resources', 'eaa-binaries', PLATFORM, BINARY_NAME),
    critical: true,
    autoFix: 'build',
    minSize: 100 * 1024, // 100KB 最小尺寸(实际 ~1.9MB)
  },
  {
    name: 'agents/ 目录',
    path: join(ROOT, 'agents'),
    critical: true,
    autoFix: null,
    isDir: true,
  },
  {
    name: 'config/ 目录',
    path: join(ROOT, 'config'),
    critical: true,
    autoFix: null,
    isDir: true,
  },
  {
    name: 'config/agents.yaml',
    path: join(ROOT, 'config', 'agents.yaml'),
    critical: true,
    autoFix: null,
  },
  {
    name: 'config/reason-codes.json',
    path: join(ROOT, 'config', 'reason-codes.json'),
    critical: true,
    autoFix: null,
  },
  {
    name: 'config/default-settings.json',
    path: join(ROOT, 'config', 'default-settings.json'),
    critical: true,
    autoFix: null,
  },
]

function checkResource(item) {
  const exists = existsSync(item.path)
  if (!exists) {
    return { ok: false, reason: 'not found' }
  }
  const stat = statSync(item.path)
  if (item.isDir && !stat.isDirectory()) {
    return { ok: false, reason: 'expected directory but found file' }
  }
  if (!item.isDir && !stat.isFile()) {
    return { ok: false, reason: 'expected file but found directory' }
  }
  if (item.minSize && stat.size < item.minSize) {
    return {
      ok: false,
      reason: `size ${stat.size} bytes < minimum ${item.minSize} bytes (binary may be corrupted)`,
    }
  }
  return { ok: true, size: stat.size }
}

async function buildEAA() {
  info('Attempting to build EAA binary from source via scripts/build-eaa.mjs ...')
  const result = spawnSync('node', ['scripts/build-eaa.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, EAA_FORCE: '1' },
  })
  if (result.status !== 0) {
    error(`Build script exited with code ${result.status}`)
    return false
  }
  info('Build completed.')
  return true
}

// ---- 主流程 ----
async function main() {
  info(`Prebuild check starting (platform: ${PLATFORM})`)
  info(`Node: ${process.version}`)

  const failures = []
  let triedAutofix = false

  for (const item of checks) {
    const result = checkResource(item)
    if (result.ok) {
      const sizeStr = result.size ? ` (${(result.size / 1024).toFixed(1)} KB)` : ''
      info(`✓ ${item.name}: OK${sizeStr}`)
    } else {
      warn(`✗ ${item.name}: ${result.reason}`)

      // 尝试自动修复(EAA 二进制缺失时从源码编译)
      if (item.autoFix === 'build' && !triedAutofix) {
        triedAutofix = true
        info(`Attempting auto-fix: ${item.name}`)
        const fixed = await buildEAA()
        if (fixed) {
          // 重新检查
          const recheck = checkResource(item)
          if (recheck.ok) {
            info(`✓ ${item.name}: OK after auto-fix`)
            continue
          }
        }
      }

      if (item.critical) {
        failures.push(item)
      }
    }
  }

  if (failures.length > 0) {
    error('')
    error('========================================')
    error('  PREBUILD CHECK FAILED')
    error('========================================')
    error(`Missing critical resources (${failures.length}):`)
    for (const f of failures) {
      error(`  - ${f.name}: ${f.path}`)
    }
    error('')
    error('To fix:')
    error('  1. For EAA binary: run `npm run build:eaa` (从源码编译，需本地 Rust 工具链，参见 https://rustup.rs)')
    error('  2. For agents/config: ensure repository is fully checked out')
    error('  3. See docs/DESKTOP_BUILD.md for details')
    process.exit(1)
  }

  info('')
  info('✓ All prebuild checks passed.')
}

main().catch((err) => {
  error(err.stack || err.message || String(err))
  process.exit(1)
})
