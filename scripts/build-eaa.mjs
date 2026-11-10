#!/usr/bin/env node
// =============================================================
// scripts/build-eaa.mjs
//
// 从 core/eaa-cli/ 源码编译当前平台的 EAA Rust 二进制，
// 放置到 resources/eaa-binaries/<platform>/ 下供 electron-builder
// 打包与 eaa-bridge 运行时使用。
//
// 这取代了旧的 download-eaa-binaries.mjs（从 GitHub Releases 下载预编译
// 二进制）—— EAA 源码就在本仓库内。发布流水线（release.yml）用
// EAA_FORCE=1 从源码编译；本地安装在指纹一致时直接用随仓库的二进制。
//
// 用法:
//   npm run build:eaa              源码指纹与随仓库二进制一致则跳过
//   EAA_FORCE=1 npm run build:eaa  强制重新编译
//   EAA_NO_LLD=1                   Windows 上不用 rust-lld（回退 MSVC link.exe）
//
// 跳过条件不是文件 mtime。Windows 上 git checkout 按写入顺序盖时间戳，
// 新鲜克隆几乎总会让 .rs 看起来比 resources/eaa-binaries 里的 eaa.exe 新，
// 于是每次安装都把已经随仓库提供的引擎又 cargo build --release 一遍。
// 指纹覆盖全部 .rs / .toml / Cargo.lock（不含 tests/ 与 target/，换行符已规范化）。
//
// 退出码:
//   0  成功（含指纹命中跳过）
//   1  cargo 不可用 / 编译失败 / 产物校验失败
//   2  平台不支持
// =============================================================

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { eaaSourceFingerprint } from './lib/eaa-source-fingerprint.mjs'

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

// ---- 缓存判断：产物已存在且源码指纹与 manifest 一致则跳过 ----
function readManifest() {
  try {
    return JSON.parse(readFileSync(join(TARGET_DIR, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

function isUpToDate(fingerprint) {
  if (FORCE) return false
  if (!existsSync(TARGET_PATH)) return false
  let size = 0
  try {
    size = statSync(TARGET_PATH).size
  } catch {
    return false
  }
  if (size < 100 * 1024) return false
  const manifest = readManifest()
  if (manifest?.source_fingerprint && manifest.source_fingerprint === fingerprint) {
    info(`源码指纹一致（${fingerprint.slice(0, 12)}…），使用已随仓库提供的二进制。跳过编译。`)
    info('改了 core/eaa-cli 或需要重编：EAA_FORCE=1 npm run build:eaa')
    if (!IS_WIN) {
      try {
        chmodSync(TARGET_PATH, 0o755)
      } catch {
        /* 非关键 */
      }
    }
    return true
  }
  return false
}

// Windows 的 link.exe 是 release 链接阶段的大头。工具链自带 rust-lld 时改用它，
// 产物功能与 MSVC 链接相同。EAA_NO_LLD=1 可关。
function windowsLldLinker() {
  if (!IS_WIN || process.env.EAA_NO_LLD === '1') return undefined
  const sys = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' })
  const host = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (sys.status !== 0 || host.status !== 0) return undefined
  const sysroot = (sys.stdout || '').trim()
  const hostTriple = /host:\s*(\S+)/.exec(host.stdout || '')?.[1]
  if (!sysroot || !hostTriple) return undefined
  const candidates = [
    join(sysroot, 'lib', 'rustlib', hostTriple, 'bin', 'rust-lld.exe'),
    join(sysroot, 'lib', 'rustlib', hostTriple, 'bin', 'gcc-ld', 'rust-lld.exe'),
  ]
  return candidates.find((p) => existsSync(p))
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

  const env = {
    ...process.env,
    // 保留调用方已设的 RUSTFLAGS，追加而非覆盖
    RUSTFLAGS: [process.env.RUSTFLAGS, ...remaps].filter(Boolean).join(' '),
  }
  const lld = windowsLldLinker()
  if (lld) {
    const triple =
      process.arch === 'arm64' ? 'AARCH64_PC_WINDOWS_MSVC' : 'X86_64_PC_WINDOWS_MSVC'
    env[`CARGO_TARGET_${triple}_LINKER`] = lld
    info(`链接器：rust-lld（${lld}）。回退 MSVC：EAA_NO_LLD=1`)
  }

  const res = spawnSync('cargo', ['build', '--release'], {
    cwd: EAA_SRC,
    stdio: 'inherit',
    env,
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
function placeBinary(fingerprint) {
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
    source_fingerprint: fingerprint,
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

  const { fingerprint, fileCount } = eaaSourceFingerprint()
  info(`源码指纹：${fingerprint.slice(0, 12)}…（${fileCount} 个构建输入）`)

  if (isUpToDate(fingerprint)) {
    info('✓ 完成（指纹命中，未调用 cargo）。')
    return
  }

  ensureCargo()
  build()
  placeBinary(fingerprint)
  info('✓ 完成。')
}

main()
