// =============================================================
// scripts/after-pack-trim.mjs — electron-builder afterPack 钩子
//
// 打包后的补齐、修剪与守卫（对应 electron-builder.yml 里的 afterPack 配置）：
//  1. 补齐 electron-builder 复制不出来的离线件（在 NSIS 打 7z 之前落盘）：
//     - vendor/dsh-im/node_modules → resources/dsh-im/node_modules.asar
//       （一个归档，不再逐文件写盘）。连接中心用 asar-preload 读取。
//     - node_modules/pnpm/dist/node_modules → 一个 node_modules.asar。
//       builder 跳过嵌套 node_modules，pnpm.mjs 兜底仍要读到 get-pnpm。
//  2. 删 dxcompiler.dll（WebGPU/Dawn 的着色器编译器，~25MB）—— 应用与
//     连接中心的 WebContentsView 都不用 WebGPU，删掉不影响渲染。
//     vk_swiftshader.dll 保留：无 GPU / 远程桌面时它还是软件 WebGL 兜底。
//  3. win 构建删 resources/eaa-binaries/ 里其他平台的目录（extraResources
//     的 filter 不分平台，win 包只需 win32-x64）；删依赖包里其他平台的
//     原生 prebuilds 与源码编译原料（npmRebuild:false 下无用）。
//  4. 守卫断言（配置改坏在这里拦，别等装到教师机）：
//     - 两个离线复制确实落位（qrcode 标记 / pnpm dist）
//     - locales 只剩 electronLanguages 白名单里的 .pak
//     - files 负向排除的大件确实不在 app.asar.unpacked 里
//
// 退出方式：守卫失败直接 process.exit(1) 让打包失败 —— afterPack 抛错时
// electron-builder 也会中止，但手动 exit 的日志更醒目。
// =============================================================

import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** electron-builder.yml electronLanguages 的单一事实来源（改那边同步改这里）。 */
const KEEP_LANGS = new Set(['zh-CN.pak', 'en-US.pak'])

/** files 负向过滤的大件：出现在 unpacked 树里即说明排除配置被改坏。 */
const EXCLUDED_IN_UNPACKED = [
  'pnpm/pnpm.exe',
  '@deepseek-ai/dsh-experimental-inspector',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  '@deepseek-ai/dsh-experimental-liveshare',
  '@deepseek-ai/dsh-experimental-client-ui-forge',
  'sherpa-onnx-win-x64',
]

export default async function afterPack(context) {
  const appOutDir = context.appOutDir
  const platform = context.packager.platform.name // 'windows' | 'mac' | 'linux'
  let removedBytes = 0

  const remove = (target, why) => {
    if (!existsSync(target)) return
    const size = dirSize(target)
    rmSync(target, { recursive: true, force: true })
    removedBytes += size
    console.log(`[after-pack-trim] -${(size / 1024 / 1024).toFixed(1)}MB ${why}`)
  }

  // ---- 1. 离线直装补齐：依赖树打成单个 asar，不逐文件进安装包 ----
  // 1a. 连接中心离线依赖（stage-dsh-im-deps 装好的生产树）。
  //     electron-builder 复制 extraResources 时整目录丢 node_modules，只能这里补。
  const asarPacker = loadAsarPacker()
  const imLoose = join(appOutDir, 'resources', 'dsh-im')
  const imSourceAsar = join(appOutDir, 'resources', 'dsh-im.asar')
  if (!existsSync(join(imLoose, 'package.json'))) {
    console.error(`[after-pack-trim] 缺少连接中心插件目录：${imLoose}`)
    process.exit(1)
  }
  asarPacker.createPackageWithOptions(imLoose, imSourceAsar, {
    unpack: '**/*.{node,dll,exe,dylib,so}',
  })
  rmSync(imLoose, { recursive: true, force: true })
  console.log(
    `[after-pack-trim] +1 dsh-im.asar（${(statSync(imSourceAsar).size / 1024 / 1024).toFixed(1)}MB，源码不再散写）`,
  )

  const imDepsSrc = join(ROOT, 'vendor', 'dsh-im', 'node_modules')
  const imAsar = join(appOutDir, 'resources', 'dsh-im-deps.asar')
  packFiltered(asarPacker, imDepsSrc, imAsar, (src) => {
    const rel = relative(imDepsSrc, src)
    if (!rel) return true
    const parts = rel.split(sep)
    if (parts[0] === '@img' && parts[1] === 'sharp-wasm32') return false
    const base = parts[parts.length - 1]
    if (base.endsWith('.map')) return false
    if (base.endsWith('.md') && /^(README|CHANGELOG)/i.test(base)) return false
    return true
  })
  if (!asarPacker.listPackage(imAsar).some((name) => name.replaceAll('\\', '/').endsWith('qrcode/package.json'))) {
    console.error(`[after-pack-trim] dsh-im 依赖归档缺少 qrcode/package.json：${imAsar}`)
    process.exit(1)
  }
  console.log(
    `[after-pack-trim] +1 dsh-im-deps.asar（${(statSync(imAsar).size / 1024 / 1024).toFixed(1)}MB，依赖树不再散写）`,
  )

  // 1b. pnpm 引导壳的嵌套依赖。主路径是 @pnpm/exe；这份归档只服务 pnpm.mjs 兜底。
  const pnpmDistSrc = join(ROOT, 'node_modules', 'pnpm', 'dist', 'node_modules')
  const pnpmAsar = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'pnpm', 'dist', 'node_modules.asar')
  if (!existsSync(pnpmDistSrc)) {
    console.error(`[after-pack-trim] 复制源缺失：${pnpmDistSrc}（pnpm 引导壳）—— 离线直装会坏，中止打包`)
    process.exit(1)
  }
  mkdirSync(dirname(pnpmAsar), { recursive: true })
  asarPacker.createPackageWithOptions(pnpmDistSrc, pnpmAsar, { unpack: '**/*.{node,dll,exe,dylib,so}' })
  if (!asarPacker.listPackage(pnpmAsar).some((name) => name.replaceAll('\\', '/').includes('get-pnpm/package.json'))) {
    console.error(`[after-pack-trim] pnpm dist 归档缺少 get-pnpm：${pnpmAsar}`)
    process.exit(1)
  }
  console.log(`[after-pack-trim] +1 pnpm/dist/node_modules.asar（${(statSync(pnpmAsar).size / 1024 / 1024).toFixed(1)}MB）`)

  // ---- 2. WebGPU 着色器编译器（所有平台都不用）----
  remove(join(appOutDir, 'dxcompiler.dll'), 'dxcompiler.dll（WebGPU 未用）')

  // ---- 3. 只面向本平台产物的修剪 ----
  // 3a. win 包不带其他平台的 eaa 二进制
  if (platform === 'windows') {
    const binRoot = join(appOutDir, 'resources', 'eaa-binaries')
    if (existsSync(binRoot)) {
      for (const name of readdirSync(binRoot)) {
        if (name !== 'win32-x64') {
          remove(join(binRoot, name), `eaa-binaries/${name}（win 包多余）`)
        }
      }
    }
  }

  // 3b. better-sqlite3 只留本平台 prebuilds（npmRebuild:false，其余平台用不到）；
  //     deps/ 是 sqlite 源码编译原料，任何平台都不进包。
  //     注意 prebuilds 下是 `win32-x64.node` 这类文件名，比较要去掉 .node 后缀
  //     ——否则本平台的也会被误删（实测踩过）。
  const unpacked = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
  const prebuildsDir = join(unpacked, 'better-sqlite3', 'prebuilds')
  if (existsSync(prebuildsDir)) {
    const keepPrefix = { windows: 'win32', darwin: 'darwin', linux: 'linux' }[platform] ?? platform
    for (const name of readdirSync(prebuildsDir)) {
      const stem = name.replace(/\.node$/, '')
      const keep = platform === 'windows' ? stem === 'win32-x64' : stem.startsWith(keepPrefix)
      if (!keep) remove(join(prebuildsDir, name), `better-sqlite3/prebuilds/${name}（非本平台）`)
    }
  }
  remove(join(unpacked, 'better-sqlite3', 'deps'), 'better-sqlite3/deps（源码编译原料，未用）')
  remove(join(unpacked, 'openai', 'src'), 'openai/src（TS 源码，运行时走包根 JS）')

  // ---- 4. 守卫断言 ----
  // 4a. locales 白名单
  const localesDir = join(appOutDir, 'locales')
  if (existsSync(localesDir)) {
    const paks = readdirSync(localesDir).filter((n) => n.endsWith('.pak'))
    const extra = paks.filter((n) => !KEEP_LANGS.has(n))
    if (extra.length > 0) {
      console.error(
        `[after-pack-trim] locales 超出白名单 ${[...KEEP_LANGS].join('/')}：${extra.join(', ')}（electronLanguages 失效？）`,
      )
      process.exit(1)
    }
  }

  // 4b. files 排除项守卫
  for (const rel of EXCLUDED_IN_UNPACKED) {
    if (existsSync(join(unpacked, ...rel.split('/')))) {
      console.error(`[after-pack-trim] 排除项混进产物：node_modules/${rel}（electron-builder.yml files 过滤失效？）`)
      process.exit(1)
    }
  }

  console.log(
    `[after-pack-trim] ${platform} 修剪完成，共 -${(removedBytes / 1024 / 1024).toFixed(1)}MB（补齐项见上方 + 行）`,
  )
}

function loadAsarPacker() {
  const candidates = [
    join(ROOT, 'node_modules', 'electron-builder', 'package.json'),
    join(ROOT, 'node_modules', '@electron', 'asar', 'package.json'),
  ]
  for (const manifest of candidates) {
    if (!existsSync(manifest)) continue
    try {
      return createRequire(manifest)('@electron/asar')
    } catch {
      /* try the next location */
    }
  }
  console.error('[after-pack-trim] 找不到 @electron/asar（electron-builder 的依赖），无法把依赖树打成单个归档')
  process.exit(1)
}

function packFiltered(asarPacker, src, dest, filter) {
  if (!existsSync(src)) {
    console.error(`[after-pack-trim] 复制源缺失：${src} —— 离线直装会坏，中止打包`)
    process.exit(1)
  }
  const stage = mkdtempSync(join(tmpdir(), 'eaa-asar-'))
  try {
    cpSync(src, stage, { recursive: true, filter })
    mkdirSync(dirname(dest), { recursive: true })
    asarPacker.createPackageWithOptions(stage, dest, { unpack: '**/*.{node,dll,exe,dylib,so}' })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

function dirSize(target) {
  const st = statSync(target)
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const name of readdirSync(target)) {
    const p = join(target, name)
    const s = statSync(p)
    total += s.isDirectory() ? dirSize(p) : s.size
  }
  return total
}
