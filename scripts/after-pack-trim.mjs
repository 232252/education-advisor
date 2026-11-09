// =============================================================
// scripts/after-pack-trim.mjs — electron-builder afterPack 钩子
//
// 打包后的补齐、修剪与守卫（对应 electron-builder.yml 里的 afterPack 配置）：
//  1. 补齐 electron-builder 复制不出来的离线件（在 NSIS 打 7z 之前落盘）：
//     - vendor/dsh-im/node_modules → resources/dsh-im/node_modules。
//       builder 复制 extraResources 时整目录丢弃 node_modules，而连接中心
//       首开离线靠它（qrcode 标记检测，im-host.ts ensurePluginDeps）。
//     - node_modules/pnpm/dist/node_modules → app.asar.unpacked 里 pnpm 的
//       同名目录。builder 复制模块树时无条件跳过嵌套 node_modules
//       （NodeModuleCopyHelper），缺了它 pnpm.mjs 引导壳起不来。
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

import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
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

  // ---- 1. 离线直装补齐（builder 丢什么这里补什么，缺源直接失败）----
  const copyDir = (src, dest, filter, why) => {
    if (!existsSync(src)) {
      console.error(`[after-pack-trim] 复制源缺失：${src}（${why}）—— 离线直装会坏，中止打包`)
      process.exit(1)
    }
    // cpSync 的 filter 只接受 function；无过滤时传 undefined（null 会 TypeError）
    cpSync(src, dest, { recursive: true, filter: filter ?? undefined })
    console.log(`[after-pack-trim] +${(dirSize(dest) / 1024 / 1024).toFixed(1)}MB ${why}`)
  }

  // 1a. 连接中心离线依赖（stage-dsh-im-deps 装好的生产树）。
  //     electron-builder 复制 extraResources 时整目录丢 node_modules，只能这里补。
  const imDepsSrc = join(ROOT, 'vendor', 'dsh-im', 'node_modules')
  const imDepsDest = join(appOutDir, 'resources', 'dsh-im', 'node_modules')
  copyDir(
    imDepsSrc,
    imDepsDest,
    (src) => {
      const rel = relative(imDepsSrc, src)
      if (!rel) return true
      const parts = rel.split(sep)
      if (parts[0] === '@img' && parts[1] === 'sharp-wasm32') return false // wasm 兜底，win32-x64 用不到
      const base = parts[parts.length - 1]
      if (base.endsWith('.map')) return false
      if (base.endsWith('.md') && /^(README|CHANGELOG)/i.test(base)) return false
      return true
    },
    'dsh-im 离线依赖（连接中心首开不再联网装）',
  )
  const qrcodeMarker = join(imDepsDest, 'qrcode', 'package.json')
  if (!existsSync(qrcodeMarker)) {
    console.error(`[after-pack-trim] dsh-im 依赖落位失败：缺 ${qrcodeMarker}`)
    process.exit(1)
  }

  // 1b. pnpm 引导壳的嵌套依赖（builder 的 NodeModuleCopyHelper 会跳过它）。
  const pnpmDistSrc = join(ROOT, 'node_modules', 'pnpm', 'dist', 'node_modules')
  const pnpmDistDest = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'pnpm', 'dist', 'node_modules')
  copyDir(pnpmDistSrc, pnpmDistDest, null, 'pnpm dist 嵌套依赖（pnpm.mjs 引导壳需要）')
  if (!existsSync(join(pnpmDistDest, 'get-pnpm', 'package.json'))) {
    console.error(`[after-pack-trim] pnpm dist 落位失败：缺 ${join(pnpmDistDest, 'get-pnpm')}`)
    process.exit(1)
  }

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
