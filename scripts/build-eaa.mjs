#!/usr/bin/env node
// =============================================================
// scripts/build-eaa.mjs
//
// 从 core/eaa-cli/ 源码编译当前平台的 EAA Rust 二进制，
// 放置到 resources/eaa-binaries/<platform>/ 下供 electron-builder
// 打包与 eaa-bridge 运行时使用。
//
// 这取代了旧的 download-eaa-binaries.mjs（从 GitHub Releases 下载预编译
// 二进制）—— EAA 源码就在本仓库内，本地与 CI（release.yml）都应从
// 源码编译，保持版本一致、可离线、可复现。
//
// 用法:
//   npm run build:eaa            编译（带缓存判断，已是最新则跳过）
//   EAA_FORCE=1 npm run build:eaa  强制重新编译
//
// 退出码:
//   0  成功（含缓存命中跳过）
//   1  cargo 不可用 / 编译失败 / 产物校验失败
//   2  平台不支持
// =============================================================

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EAA_SRC = join(ROOT, 'core', 'eaa-cli')
const FORCE = process.env.EAA_FORCE === '1'

// ---- 日志 ----
function log(level, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [build-eaa:${level}] ${msg}`)
}
const info = (m) => log('info', m)
const warn = (m) => log('warn', m)
const error = (m) => log('error', m)

// ---- 平台检测（键与 eaa-bridge.ts 的 PLATFORM_DIR 一致）----
function detectPlatform() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'win32' }
  const archMap = { x64: 'x64', arm64: 'arm64' }
  const p = platformMap[process.platform]
  const a = archMap[process.arch]
  if (!p || !a) {
    error(`Unsupported platform: ${process.platform}/${process.arch}`)
    error('Supported: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64')
    process.exit(2)
  }
  return `${p}-${a}`
}

const PLATFORM = detectPlatform()
const IS_WIN = process.platform === 'win32'
const BINARY_NAME = IS_WIN ? 'eaa.exe' : 'eaa'

const TARGET_DIR = join(ROOT, 'resources', 'eaa-binaries', PLATFORM)
const TARGET_PATH = join(TARGET_DIR, BINARY_NAME)
const SOURCE_BIN = join(EAA_SRC, 'target', 'release', BINARY_NAME)

// ---- cargo 可用性 ----
function ensureCargo() {
  const res = spawnSync('cargo', ['--version'], { stdio: 'pipe' })
  if (res.status !== 0 || res.error) {
    error('未检测到 Rust 工具链（cargo 不可用）。')
    error('EAA 现已改为强制源码编译，不再提供下载。')
    error('请先安装 Rust：https://rustup.rs/')
    error('或确认 cargo 已在 PATH 中。')
    process.exit(1)
  }
  const version = (res.stdout?.toString() || '').trim()
  if (version) info(`cargo: ${version}`)
}

// ---- 缓存判断：产物已存在且新于源码则跳过 ----
function newestSourceMtime(dir, maxDepth = 2) {
  let newest = 0
  const walk = (d, depth) => {
    let entries = []
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      // 跳过 target/（编译产物）等无关目录
      if (e.isDirectory()) {
        if (e.name === 'target' || e.name === '.git') continue
        if (depth < maxDepth) walk(join(d, e.name), depth + 1)
      } else if (e.isFile() && /\.rs$/i.test(e.name)) {
        try {
          const m = statSync(join(d, e.name)).mtimeMs
          if (m > newest) newest = m
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir, 0)
  return newest
}

function isUpToDate() {
  if (FORCE) return false
  if (!existsSync(TARGET_PATH)) return false
  let binMtime = 0
  try {
    binMtime = statSync(TARGET_PATH).mtimeMs
  } catch {
    return false
  }
  const srcMtime = newestSourceMtime(EAA_SRC)
  if (srcMtime > 0 && binMtime >= srcMtime) {
    info(`已是最新（产物 mtime ${new Date(binMtime).toISOString()} ≥ 源码）。跳过编译。`)
    info('如需强制重编：EAA_FORCE=1 npm run build:eaa')
    return true
  }
  return false
}

// ---- 编译 ----
function build() {
  info(`从源码编译 EAA：${EAA_SRC}`)
  info(`目标平台：${PLATFORM} → ${TARGET_PATH}`)

  // 隐私/可复现性：Rust 会把源码绝对路径写进 panic 位置与 debug 信息。
  // 不重映射时，Windows 产物会带 141 处 `C:\Users\<用户名>\...`（含 .cargo /
  // .rustup 路径），开源发布即等于泄露构建机用户名；同时也让不同机器的产物
  // 无法复现比对。--remap-path-prefix 把构建机前缀换成稳定的占位路径。
  //
  // 用 RUSTFLAGS 环境变量而不是 cargo --config：Windows 路径含反斜杠，塞进
  // TOML 字符串会被当作转义序列而解析失败（实测 "\U" → unicode 转义报错）。
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const remaps = []
  for (const [from, to] of [
    [home, '/build/home'],
    [join(home, '.cargo'), '/build/cargo'],
    [join(home, '.rustup'), '/build/rustup'],
    [EAA_SRC, '/build/eaa-src'],
    [ROOT, '/build/repo'],
  ]) {
    if (from) remaps.push(`--remap-path-prefix=${from}=${to}`)
  }
  if (home) info(`路径重映射：${home} → /build/home（产物不含构建机路径）`)

  const res = spawnSync('cargo', ['build', '--release'], {
    cwd: EAA_SRC,
    stdio: 'inherit',
    env: {
      ...process.env,
      // 保留调用方已设的 RUSTFLAGS，追加而非覆盖
      RUSTFLAGS: [process.env.RUSTFLAGS, ...remaps].filter(Boolean).join(' '),
    },
  })
  if (res.status !== 0) {
    error(`cargo build 失败（exit ${res.status}）`)
    process.exit(1)
  }
}

// ---- 隐私守卫：产物里不能出现构建机绝对路径 ----
function assertNoBuildPathLeak(binPath) {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  let buf
  try {
    buf = readFileSync(binPath)
  } catch (err) {
    warn(`无法读取产物做路径检查：${errText(err)}`)
    return
  }
  const text = buf.toString('latin1')
  const leaks = []
  if (home) {
    // 正反斜杠两种写法都要查
    for (const p of [home, home.replace(/\\/g, '/')]) {
      const n = text.split(p).length - 1
      if (n > 0) leaks.push(`${p} ×${n}`)
    }
  }
  for (const m of text.matchAll(/[A-Za-z]:\\Users\\[^\\\0-\x1f"']+/g)) {
    leaks.push(m[0])
  }
  if (leaks.length > 0) {
    error('产物包含构建机绝对路径，开源发布前必须消除：')
    for (const l of [...new Set(leaks)].slice(0, 5)) error(`  ${l}`)
    error('已启用 --remap-path-prefix，若仍出现请检查是否有预编译依赖（build script / proc-macro）')
    process.exit(1)
  }
  info('路径检查通过：产物不含构建机绝对路径')
}

function errText(err) {
  return err instanceof Error ? err.message : String(err)
}

// ---- 放置产物 ----
function placeBinary() {
  if (!existsSync(SOURCE_BIN)) {
    error(`编译产物不存在：${SOURCE_BIN}`)
    error('请检查 cargo build 输出。')
    process.exit(1)
  }
  mkdirSync(TARGET_DIR, { recursive: true })
  copyFileSync(SOURCE_BIN, TARGET_PATH)

  // POSIX 需要可执行权限
  if (!IS_WIN) {
    chmodSync(TARGET_PATH, 0o755)
  }

  // 校验产物大小（与 prebuild-check 的 minSize 100KB 一致）
  const size = statSync(TARGET_PATH).size
  if (size < 100 * 1024) {
    error(`产物过小（${size} 字节 < 100KB），可能已损坏。`)
    process.exit(1)
  }
  info(`产物已放置：${TARGET_PATH} (${(size / 1024).toFixed(1)} KB)`)

  // 隐私守卫：产物不得含构建机绝对路径(开源发布前最容易漏的一项)
  assertNoBuildPathLeak(TARGET_PATH)

  // 写 manifest（记录编译信息，便于排查版本不匹配）
  const cargoVerRes = spawnSync('cargo', ['--version'], { stdio: 'pipe' })
  const manifest = {
    built_at: new Date().toISOString(),
    platform: PLATFORM,
    binary: BINARY_NAME,
    cargo_version: (cargoVerRes.stdout?.toString() || '').trim(),
    source: 'core/eaa-cli (本地源码编译)',
  }
  try {
    writeFileSync(join(TARGET_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  } catch {
    /* 非关键，忽略 */
  }
}

// ---- 主流程 ----
function main() {
  info(`Build EAA starting (platform: ${PLATFORM}, force: ${FORCE})`)
  info(`Node: ${process.version}`)

  // Windows ARM64 边界提示（不阻塞）
  if (PLATFORM === 'win32-arm64') {
    warn('检测到 Windows ARM64：已编译 arm64 原生二进制到 win32-arm64/。')
    warn('注意：eaa-bridge 运行时当前会回退使用 win32-x64 二进制（见 PLATFORM_DIR 映射）。')
    warn('如需匹配运行时行为，请额外在 x64 环境编译 win32-x64 产物。')
  }

  if (isUpToDate()) {
    info('✓ 完成（缓存命中）。')
    return
  }

  ensureCargo()
  build()
  placeBinary()
  info('✓ 完成。')
}

main()
