#!/usr/bin/env node
// =============================================================
// Windows（以及任何平台）的完整安装入口。
//
// 结果与 `npm ci` + `npm run build:eaa` 相同：全部依赖、原生预编译模块、
// 随仓库的 EAA 引擎。不裁功能。快在三处：
//   1. 源码指纹命中时不再 cargo build --release（见 build-eaa.mjs）
//   2. npm 并行拉取，并优先用本机缓存
//   3. 到 npmjs / GitHub 明显更慢时，改走 npmmirror（锁文件 integrity 不变）
//
// 用法:
//   node scripts/windows-install.mjs
//   node scripts/windows-install.mjs --mirror official
//   node scripts/windows-install.mjs --mirror cn
//   node scripts/windows-install.mjs --mirror auto     默认
//
// 已设置的 npm registry / ELECTRON_MIRROR 不会被覆盖。
// =============================================================

import { spawn, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { preferMirror } from './lib/install-mirror.mjs'

const ELECTRON_VERSION = '45.0.0'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const NPM_MIRROR = 'https://registry.npmmirror.com/'
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'

const mirrorFlag = argValue('--mirror') ?? process.env.EAA_INSTALL_MIRROR ?? 'auto'
if (!['auto', 'official', 'cn'].includes(mirrorFlag) || process.argv.includes('--help') || process.argv.includes('-h')) {
  if (!['auto', 'official', 'cn'].includes(mirrorFlag)) {
    console.error(`[windows-install] 未知 --mirror ${mirrorFlag}（可用 auto | official | cn）`)
    process.exit(2)
  }
  console.log(`用法: node scripts/windows-install.mjs [--mirror auto|official|cn]

完整安装（依赖 + 原生模块 + EAA 引擎）。默认 --mirror auto：
只有镜像明显更快时才改用 npmmirror，否则保持 npmjs 与 GitHub。`)
  process.exit(process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2)
}

const userRegistry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY
const userElectronMirror = process.env.ELECTRON_MIRROR

const started = performance.now()
const choice = await chooseMirrors(mirrorFlag)
console.log(`[windows-install] npm registry: ${choice.registry ?? '(npm 默认)'}`)
console.log(`[windows-install] ELECTRON_MIRROR: ${choice.electronMirror ?? '(GitHub 官方)'}`)

const npm = resolveNpmInvocation()
const ciEnv = installEnv(choice)
const ciArgs = [...npm.prefix, 'ci', '--prefer-offline', '--no-audit', '--no-fund']
const ciStatus = await run(npm.command, ciArgs, ciEnv)
if (ciStatus !== 0 && choice.usedMirror) {
  console.warn('[windows-install] 镜像安装失败，改走 npmjs / GitHub 再试一次')
  const officialEnv = installEnv({ registry: undefined, electronMirror: undefined, usedMirror: false })
  const retry = await run(npm.command, [...npm.prefix, 'ci', '--no-audit', '--no-fund'], officialEnv)
  if (retry !== 0) process.exit(retry)
} else if (ciStatus !== 0) {
  process.exit(ciStatus)
}

const eaa = await run(process.execPath, ['scripts/build-eaa.mjs'], process.env)
if (eaa !== 0) process.exit(eaa)

const seconds = ((performance.now() - started) / 1000).toFixed(1)
console.log(`[windows-install] 完成（${seconds}s）。依赖与 EAA 引擎已就绪，功能与 npm ci + build:eaa 相同。`)
console.log('[windows-install] 下一步: npm run dev    另开终端: npm run dev:electron')

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

async function chooseMirrors(mode) {
  if (mode === 'official') return { registry: undefined, electronMirror: undefined, usedMirror: false }
  if (mode === 'cn') {
    return {
      registry: userRegistry ?? NPM_MIRROR,
      electronMirror: userElectronMirror ?? ELECTRON_MIRROR,
      usedMirror: !userRegistry || !userElectronMirror,
    }
  }
  const [npmOfficial, npmMirror, gh, elecMirror] = await Promise.all([
    latency(`${NPM_REGISTRY}pnpm/12.15.0`),
    latency(`${NPM_MIRROR}pnpm/12.15.0`),
    latency(`https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/SHASUMS256.txt`),
    latency(`${ELECTRON_MIRROR}v${ELECTRON_VERSION}/SHASUMS256.txt`),
  ])
  console.log(
    `[windows-install] 探测 ms  npmjs=${fmt(npmOfficial)} npmmirror=${fmt(npmMirror)} github=${fmt(gh)} electron-mirror=${fmt(elecMirror)}`,
  )
  const useNpm = !userRegistry && preferMirror(npmOfficial, npmMirror)
  const useElectron = !userElectronMirror && preferMirror(gh, elecMirror)
  return {
    registry: useNpm ? NPM_MIRROR : undefined,
    electronMirror: useElectron ? ELECTRON_MIRROR : undefined,
    usedMirror: useNpm || useElectron,
  }
}

function installEnv(choice) {
  const env = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_progress: 'false',
    npm_config_maxsockets: process.env.npm_config_maxsockets || '32',
    npm_config_build_from_source: 'false',
  }
  if (choice.registry) env.npm_config_registry = choice.registry
  if (choice.electronMirror) env.ELECTRON_MIRROR = choice.electronMirror
  else if (!userElectronMirror) delete env.ELECTRON_MIRROR
  return env
}

function resolveNpmInvocation() {
  const version = spawnSync('npm', ['-v'], { encoding: 'utf8', shell: process.platform === 'win32' })
  const major = Number.parseInt((version.stdout || '').trim(), 10)
  // vendored pi-ai 的可选 peer 会让 npm 10.9 Arborist 在 install 时崩溃。
  // npm 11 装出来的树与锁文件一致，只是安装器本身换成能跑完的版本。
  if (!Number.isFinite(major) || major < 11) {
    console.log(`[windows-install] 当前 npm ${version.stdout?.trim() || '(未知)'}，改用 npx npm@11 执行 npm ci`)
    return {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      prefix: ['--yes', 'npm@11'],
    }
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] }
}

async function latency(url) {
  const start = performance.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'follow' })
    if (!res.ok) return Number.POSITIVE_INFINITY
    await res.arrayBuffer()
    return performance.now() - start
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function fmt(ms) {
  return Number.isFinite(ms) ? ms.toFixed(0) : 'fail'
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', (err) => {
      console.error(`[windows-install] 无法启动 ${command}: ${err.message}`)
      resolve(1)
    })
  })
}
