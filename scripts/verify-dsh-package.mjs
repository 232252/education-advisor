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
//  4. electron-builder.config.mjs 的 asarUnpack 覆盖 dsh/pnpm 闭包与原生二进制
//     （纯 node 子进程看不见 app.asar；其余 JS 留在归档里，安装少写散文件）
//  5. 随包 pnpm 工具链在位：@pnpm/exe 的真二进制（dsh plugin add 只认
//     PATH 上的真 exe；pnpm 12 的 pnpm.mjs 只是 corepack 引导壳，真 CLI
//     只有 @pnpm/exe 的原生二进制，替代方案实测死路）+ pnpm.mjs 引导壳
//     + pnpm/dist/node_modules 嵌套依赖（builder 跳过、afterPack 补回，
//     兜底链路才完整；教师机器没有全局 pnpm —— 见 pnpm-env.ts）
//  6. 瘦身排除安全网：被 files 负向过滤的包不在 web/sdk profile 的硬依赖闭包里
//     （闭包只走 dependencies；optionalDependencies 是"可缺席"的，正是按需补装的前提）
//  7. office-kit 随包组件：config/office-kit.json 清单在位（prepackage 生成，
//     兼作损坏修复通道的资产定位）
//  8. 可选 --dist <win-unpacked>：核对打包产物里入口确实落在 app.asar.unpacked 下，
//     离线直装三件套落位（dsh-im 依赖 / pnpm dist / libreoffice-kit 平台包），
//     且瘦身负向过滤确实生效（pnpm 二进制别名 / 实验包 / source map / README
//     图被剥掉；清单/locales 裁剪在位）
//
// 用法: npm run verify:dsh [-- --dist release/win-unpacked]
// 退出码: 0 全部通过 / 1 有失败项
// =============================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asarUnpackPatterns, assertUnpackContract } from './lib/asar-unpack-patterns.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = '@deepseek-ai/dsh-sdk-client'
const RUNTIME = '@deepseek-ai/dsh'
// @pnpm/exe 的平台包名按构建机走（optionalDependencies 各平台各装一份）。
const PNM_EXE_DIR = join('node_modules', '@pnpm', `exe.${process.platform}-${process.arch}`)
const PNM_EXE = join(PNM_EXE_DIR, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
const PNM_MJS = join('node_modules', 'pnpm', 'bin', 'pnpm.mjs')
const PNM_DIST = join('node_modules', 'pnpm', 'dist', 'node_modules')
// electron-builder.yml files 里被负向排除的包（体积/按需化）。
// 对 web/sdk profile 是硬依赖的包不能进这个清单 —— 见第 6 项安全网。
// （libreoffice-kit-win32-x64 2026-11-09 起随包分发，已移出本清单。）
const SLIM_EXCLUDED_PACKAGES = [
  '@deepseek-ai/dsh-experimental-inspector',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  'sherpa-onnx-node',
  'sherpa-onnx-win-x64',
  '@deepseek-ai/dsh-experimental-liveshare',
  '@deepseek-ai/dsh-experimental-client-ui-forge',
]
// dsh-official-bundles 的 PROFILE_TEMPLATES：web 与 sdk 是本 app 用到的两个
// profile（教师对话 sdk、连接中心 web）。
const PROFILE_BUNDLE_ROOTS = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-sdk-app',
]

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

const unpackProblems = assertUnpackContract()
check(
  unpackProblems.length === 0,
  'asarUnpack 解开 dsh/pnpm 闭包与原生二进制，其余 JS 留在 app.asar',
  unpackProblems.join('; ') || `${asarUnpackPatterns().length} patterns`,
)
const rootPkg = readJson(join(ROOT, 'package.json'))
for (const scriptName of ['package', 'package:portable', 'package:installer']) {
  check(
    (rootPkg.scripts?.[scriptName] ?? '').includes('--config electron-builder.config.mjs'),
    `${scriptName} 使用收窄后的 asarUnpack`,
    rootPkg.scripts?.[scriptName] ?? '缺少脚本',
  )
}
check(
  readFileSync(join(ROOT, 'electron-builder.config.mjs'), 'utf8').includes('asarUnpackPatterns'),
  'electron-builder.config.mjs 按闭包计算 asarUnpack',
)

// ---- 随包 pnpm 工具链（连接中心 plugin add 的物质基础）----
check(
  existsSync(join(ROOT, PNM_EXE)),
  `随包 @pnpm/exe 二进制在位 (${PNM_EXE})`,
  '缺失时安装版 dsh plugin add 会在无全局 pnpm 的教师机上失败（pnpm.mjs 只是引导壳，顶不上）',
)
check(
  existsSync(join(ROOT, PNM_MJS)),
  'pnpm 包的 pnpm.mjs 引导壳原料在位',
  '缺失时 exe 不可用平台的兜底链路缺原料',
)
check(
  existsSync(join(ROOT, PNM_DIST)),
  'pnpm/dist/node_modules 嵌套依赖在位（builder 跳过、afterPack 补回的原料）',
  '缺失时 pnpm.mjs 引导壳 import get-pnpm 失败，回退安装联网也起不来',
)

// ---- office-kit 按需组件清单（win32）----
// config/office-kit.json 由 prepackage 生成且 gitignore —— 干净检出（CI）没有
// 它属正常，SKIP；在位但内容坏才是真问题。打包产物内的在位性由 --dist 断言
// （resources/config/office-kit.json）把关，那里缺失仍会 hard fail。
if (process.platform === 'win32') {
  const manifestPath = join(ROOT, 'config', 'office-kit.json')
  if (!existsSync(manifestPath)) {
    checks.push('SKIP office-kit 清单在位 (config/office-kit.json) — 未跑 prepackage（干净检出属正常，--dist 断言管打包产物）')
  } else {
    let manifestOk = false
    let manifestDetail = '文件在但内容坏（缺 asset/sha256/bytes 字段）'
    try {
      const manifest = readJson(manifestPath)
      manifestOk = Boolean(manifest.asset && manifest.sha256 && manifest.bytes > 0)
      if (manifestOk) manifestDetail = `${manifest.asset} (${(manifest.bytes / 1024 / 1024).toFixed(0)}MB)`
    } catch {
      /* detail 保持默认 */
    }
    check(manifestOk, 'office-kit 清单在位 (config/office-kit.json)', manifestDetail)
  }
}

// ---- 瘦身排除安全网：排除包不得是活跃 profile 的硬依赖 ----
verifyBundleClosure()

function dependencyClosure(roots) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const name = queue.pop()
    if (seen.has(name)) continue
    seen.add(name)
    let pkg
    try {
      pkg = readJson(join(ROOT, 'node_modules', ...name.split('/'), 'package.json'))
    } catch {
      continue
    }
    // 只走 dependencies（硬依赖）。optionalDependencies 是"可缺席"的——
    // libreoffice-kit 平台包正是经 optionalDependencies 按需补装的前提。
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push(dep)
  }
  return seen
}

function verifyBundleClosure() {
  const closure = dependencyClosure(PROFILE_BUNDLE_ROOTS)
  const offenders = SLIM_EXCLUDED_PACKAGES.filter((name) => closure.has(name))
  check(
    offenders.length === 0,
    '瘦身排除包不在 web/sdk profile 硬依赖闭包内',
    offenders.length > 0 ? `这些包被排除但会被 profile 硬加载，必须移出 files 排除清单：${offenders.join(', ')}` : `${closure.size} 个包的闭包已核对`,
  )
}

function verifyDist(entry, binRel) {
  const at = process.argv.indexOf('--dist')
  if (at < 0) return
  const dist = resolve(process.argv[at + 1] || '')
  const unpackedRoot = join(dist, 'resources', 'app.asar.unpacked')
  const unpacked = join(unpackedRoot, 'node_modules', RUNTIME, binRel)
  check(existsSync(unpacked), '打包产物内 dsh 入口已解出为真实文件', unpacked)
  check(
    existsSync(join(unpackedRoot, PNM_EXE)),
    '打包产物内随包 pnpm.exe 已解出',
    join(unpackedRoot, PNM_EXE),
  )
  check(
    existsSync(join(dist, 'resources', 'config', 'office-kit.json')),
    '打包产物内 office-kit 清单在位 (resources/config/office-kit.json)',
    '随包后兼作损坏修复通道的资产定位与校验',
  )
  // 瘦身负向过滤生效性：这些路径在 electron-builder.yml files 里被排除，
  // 出现即说明过滤配置被改坏（体积/散文件数回归）。
  const slimExcluded = [
    join(unpackedRoot, 'node_modules', 'pnpm', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'),
    ...SLIM_EXCLUDED_PACKAGES.map((name) => join(unpackedRoot, 'node_modules', ...name.split('/'))),
  ]
  for (const gone of slimExcluded) {
    check(!existsSync(gone), `瘦身排除项未混入产物 (${gone.slice(dist.length + 1)})`)
  }
  // locales 白名单（electronLanguages + afterPack 双保险）
  const localesDir = join(dist, 'locales')
  if (existsSync(localesDir)) {
    const paks = readdirSync(localesDir).filter((n) => n.endsWith('.pak'))
    check(
      paks.every((n) => n === 'zh-CN.pak' || n === 'en-US.pak'),
      '打包产物 locales 只含 zh-CN/en-US',
      paks.filter((n) => n !== 'zh-CN.pak' && n !== 'en-US.pak').join(', '),
    )
  }
  check(!existsSync(join(dist, 'dxcompiler.dll')), 'WebGPU 的 dxcompiler.dll 已修剪')
  // dsh-im 运行时会加载 src/plugin-src/docs（lib 直接引用），瘦身不许砍过头；
  // README 大图则应当被剥掉。
  const imRoot = join(dist, 'resources', 'dsh-im')
  for (const kept of ['src', 'plugin-src', 'docs', 'bin', 'lib', 'integrations']) {
    check(existsSync(join(imRoot, kept)), `dsh-im 运行时目录在产物内 (${kept})`)
  }
  check(
    existsSync(join(imRoot, 'assets', 'logo-plugin-message-link-gradient.webp')),
    'dsh-im 的 icon webp 在产物内',
  )
  check(
    !existsSync(join(imRoot, 'assets', 'sponsors')),
    'dsh-im 的 README 赞助商图已被剥掉',
  )
  // ---- 离线直装三件套（afterPack 补齐，缺一件新装机器就不是全功能离线）----
  check(
    existsSync(join(imRoot, 'node_modules', 'qrcode', 'package.json')),
    'dsh-im 离线依赖在产物内 (qrcode 标记)',
    '缺失时首开连接中心走在线修复路 —— afterPack 的 dsh-im 依赖复制丢了',
  )
  check(
    !existsSync(join(imRoot, 'node_modules', '@img', 'sharp-wasm32')),
    'dsh-im 依赖里的 sharp wasm 兜底已剥掉',
  )
  check(
    existsSync(join(unpackedRoot, 'node_modules', 'pnpm', 'dist', 'node_modules', 'get-pnpm', 'package.json')),
    '产物内 pnpm/dist/node_modules 已由 afterPack 补回',
    '缺失时 pnpm.mjs 引导壳起不来，组件修复链路死',
  )
  if (process.platform === 'win32') {
    check(
      existsSync(
        join(
          unpackedRoot,
          'node_modules',
          '@deepseek-ai',
          'libreoffice-kit-win32-x64',
          'bin',
          'libreoffice-kit.exe',
        ),
      ),
      'libreoffice-kit 平台包随包在产物内',
      '缺失时 AI 文档转 PDF 退化为联网按需补装（2026-11-09 决策：随包分发）',
    )
  }
  // source map 是散文件数第一大头（~1.07 万个），混回来会拖慢安装写盘。
  const maps = []
  const total = { files: 0, bytes: 0 }
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else {
        total.files += 1
        total.bytes += st.size
        if (name.endsWith('.map') && maps.length < 3) maps.push(p.slice(dist.length + 1))
      }
    }
  }
  walk(dist)
  check(maps.length === 0, '产物内无 source map 散文件', maps.join(', '))
  console.log(
    `产物统计: ${total.files} 个文件, ${(total.bytes / 1024 / 1024).toFixed(0)} MB 解包体积`,
  )
}

console.log(`verify-dsh-package: ${checks.length - failures.length}/${checks.length} 通过`)
for (const line of checks) if (!line.startsWith('PASS')) console.log('  ' + line)
if (failures.length) {
  console.error(`\ndsh 装配门禁失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
