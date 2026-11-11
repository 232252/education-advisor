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
//  4. electron-builder 的 asarUnpack 是 prepackage 生成的闭包清单（第四轮安装
//     提速：整树解包是反模式，只有 dsh 子进程闭包 + pnpm/pdfjs 保留落盘，
//     其余纯 JS 依赖收进 app.asar 由主进程读）
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
//     离线三件套落位（dsh-im 依赖 / pnpm dist / office-kit 随包 zip），且瘦身
//     负向过滤确实生效；第三轮内容级核查（sweep 残留/聚合/字体发射）；
//     第四轮选择性解包核查：对照 build/unpack-closure.json 逐包核对落盘清单、
//     asar 头解析确认主进程专用包真在归档内、staged node.exe 离线跑通
//     dsh --version（闭包完整性的最终证据）
//
// 用法: npm run verify:dsh [-- --dist release/win-unpacked]
// 退出码: 0 全部通过 / 1 有失败项
// =============================================================

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = '@deepseek-ai/dsh-sdk-client'
const RUNTIME = '@deepseek-ai/dsh'
// prepackage 生成的 asarUnpack 对照清单（compute-unpack-closure.mjs 落盘）
const CLOSURE_JSON = join(ROOT, 'build', 'unpack-closure.json')
// @pnpm/exe 的平台包名按构建机走（optionalDependencies 各平台各装一份）。
const PNM_EXE_DIR = join('node_modules', '@pnpm', `exe.${process.platform}-${process.arch}`)
const PNM_EXE = join(PNM_EXE_DIR, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
const PNM_MJS = join('node_modules', 'pnpm', 'bin', 'pnpm.mjs')
const PNM_DIST = join('node_modules', 'pnpm', 'dist', 'node_modules')
// electron-builder.yml files 里被负向排除的包（体积/按需化）。
// 对 web/sdk profile 是硬依赖的包不能进这个清单 —— 见第 6 项安全网。
// libreoffice-kit-win32-x64 2026-11-09 起随包（当日决策预解压，第四轮改为
// 随包 zip 首用本地解压）——包本体进本清单，zip 的在位性由 --dist 单独断言。
// 字体三包 2026-11-11 起排除：纯构建期依赖，vite 发射进 dist 后包体不被
// 任何运行时代码引用（lxgw 曾因 @import url 悬空在打包态整体 404，
// 修法见 src/renderer/main.tsx 注释）。
const SLIM_EXCLUDED_PACKAGES = [
  '@deepseek-ai/libreoffice-kit-win32-x64',
  '@deepseek-ai/dsh-experimental-inspector',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  'sherpa-onnx-node',
  'sherpa-onnx-win-x64',
  '@deepseek-ai/dsh-experimental-liveshare',
  '@deepseek-ai/dsh-experimental-client-ui-forge',
  'lxgw-wenkai-webfont',
  '@fontsource/jetbrains-mono',
  '@fontsource-variable/inter',
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

const builderYml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
check(
  builderYml.includes('# >>> unpack-closure') &&
    /node_modules\/@deepseek-ai\/\*\*/.test(builderYml) &&
    !/["']\*\*\/node_modules\/\*\*["']/.test(builderYml),
  'asarUnpack 为生成闭包清单（整树解包反模式已移除）',
  '哨兵块 + @deepseek-ai scope 缺失，或整树 "**/node_modules/**" 复活 —— 见 compute-unpack-closure.mjs',
)
if (!existsSync(CLOSURE_JSON)) {
  checks.push('SKIP unpack-closure.json 生成清单 — 未跑 prepackage（干净检出属正常）')
} else {
  let closureCount = 0
  try {
    closureCount = readJson(CLOSURE_JSON).packages.length
  } catch {
    /* 下方 --dist 对照会报 */
  }
  check(closureCount >= 400, 'unpack-closure.json 清单规模合理', `${closureCount} 包（dsh 闭包 ~580）`)
}

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
    // libreoffice-kit 不再预解压随包（SLIM 排除清单已断言包目录缺席）；随包
    // 只有 1 个 zip，必须与 config 清单同名字节数一致（首用本地解压的物料，
    // 缺了/坏了都会在首次 AI 转 PDF 时退化到在线下载）。
    let kitZipOk = false
    let kitZipDetail
    try {
      const kitZips = readdirSync(join(dist, 'resources', 'office-kit')).filter((n) => n.endsWith('.zip'))
      const kitManifest = readJson(join(dist, 'resources', 'config', 'office-kit.json'))
      if (kitZips.length === 1 && kitZips[0] === kitManifest.asset) {
        const zipBytes = statSync(join(dist, 'resources', 'office-kit', kitZips[0])).size
        kitZipOk = zipBytes === kitManifest.bytes
        kitZipDetail = kitZipOk
          ? `${kitZips[0]}（${(zipBytes / 1024 / 1024).toFixed(1)}MB，与清单一致）`
          : `字节数不符：zip ${zipBytes} ≠ 清单 ${kitManifest.bytes}`
      } else {
        kitZipDetail = `zip ${kitZips.join(', ') || '无'} vs 清单 ${kitManifest.asset}`
      }
    } catch (err) {
      kitZipDetail = `读取失败：${err instanceof Error ? err.message : String(err)}`
    }
    check(kitZipOk, 'office-kit 随包 zip 在位且与清单一致（首用本地解压物料）', kitZipDetail)
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

  // ---- 第三轮瘦身（junk 大扫除 + 字体出包）内容级核查 ----
  // 教训（lxgw 字体子集丢失，见 spec 勘误）：只查大件存在性抓不到小文件
  // 缺失。这里对 sweep 的每条规则做双向核查：删干净了（junk == 0）、
  // 没删过头（包根 package.json 全在位、字体资产真被发射）。
  const PROTECTED_SCOPES = new Set(['@deepseek-ai', '@earendil-works'])
  const PROTECTED_PKGS = new Set(['pnpm', 'pdfjs-dist', 'typescript'])
  const isProtectedPath = (parts) =>
    parts[0]?.startsWith('@')
      ? PROTECTED_SCOPES.has(parts[0]) || PROTECTED_PKGS.has(`${parts[0]}/${parts[1] ?? ''}`)
      : PROTECTED_PKGS.has(parts[0])
  const nmTrees = [
    [join(unpackedRoot, 'node_modules'), 'node_modules'],
    [join(dist, 'resources', 'dsh-im', 'node_modules'), 'dsh-im/node_modules'],
  ]
  let dtsResidue = 0
  let licenseResidue = 0
  const pkgJsonMissing = []
  const auditTree = (nmRoot) => {
    if (!existsSync(nmRoot)) return
    // 包根 package.json 在位性（模块解析链命脉，runtime.ts 靠它定位入口）
    for (const top of readdirSync(nmRoot)) {
      if (top.startsWith('.')) continue // .bin / .pnpm 等非包目录
      const topPath = join(nmRoot, top)
      if (!statSync(topPath).isDirectory()) continue
      const pkgDirs = top.startsWith('@')
        ? readdirSync(topPath).map((d) => join(top, d))
        : [top]
      for (const pd of pkgDirs) {
        if (!existsSync(join(nmRoot, pd, 'package.json'))) pkgJsonMissing.push(pd.split('\\').join('/'))
      }
    }
    const walkAudit = (dir, parts) => {
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
        if (st.isDirectory()) {
          const next = [...parts, name]
          if (isProtectedPath(next)) continue
          walkAudit(p, next)
        } else {
          if (/\.(d\.ts|d\.mts|d\.cts)$/.test(name)) dtsResidue += 1
          else if (/^(licen[cs]e|copying|notice|patents)/i.test(name) && !/\.(js|mjs|cjs|ts|mts|cts|tsx|json|map)$/i.test(name))
            licenseResidue += 1
        }
      }
    }
    walkAudit(nmRoot, [])
  }
  for (const [nmRoot] of nmTrees) auditTree(nmRoot)
  check(
    pkgJsonMissing.length === 0,
    'sweep 后每个包根的 package.json 都在位',
    pkgJsonMissing.length > 0 ? `缺失：${pkgJsonMissing.slice(0, 5).join(', ')}` : '两棵 node_modules 全量核对',
  )
  check(
    dtsResidue === 0,
    '保护树（@deepseek-ai 等）外无 *.d.ts 残留',
    dtsResidue > 0 ? `残留 ${dtsResidue} 个` : '含 dsh-im 树',
  )
  const noticesPath = join(dist, 'resources', 'THIRD-PARTY-NOTICES.txt')
  let noticesBytes = 0
  try {
    noticesBytes = statSync(noticesPath).size
  } catch {
    /* 缺文件按 0 处理 */
  }
  check(
    licenseResidue === 0 && noticesBytes > 1024 * 1024,
    'LICENSE 已聚合为 THIRD-PARTY-NOTICES.txt',
    licenseResidue > 0
      ? `仍散落 ${licenseResidue} 个许可文件`
      : noticesBytes <= 1024 * 1024
        ? '聚合文件缺失或过小（<1MB）'
        : `${(noticesBytes / 1024 / 1024).toFixed(1)}MB`,
  )
  // 字体出包双向断言：app.asar 内 CSS 要么带哈希资产 url（修好），要么连
  // url 都没有（未引字体）；出现 './files/lxgwwenkai' 即 @import 悬空 404
  // 的原始签名（批注手写体会静默回退楷体）。
  const asarPath = join(dist, 'resources', 'app.asar')
  if (existsSync(asarPath)) {
    const asarText = readFileSync(asarPath, 'latin1')
    const emitted = asarText.split('lxgwwenkai-light-subset-').length - 1
    const dangling = asarText.includes('./files/lxgwwenkai')
    check(
      emitted >= 90 && !dangling,
      '霞鹜文楷 light 子集已发射进渲染产物（批注手写体可用）',
      dangling
        ? `CSS 仍有 ${emitted} 处悬空 ./files/ 引用（404 回退楷体）`
        : `${emitted} 处按需加载分片引用`,
    )
  }
  // ---- 第四轮安装提速（选择性解包）内容级核查 ----
  // 整树解包 → 闭包落盘后，三条证据链缺一不可：
  //  a) 生成清单里的每个包都真实落盘 + 落盘树里没有清单外的包（文件数不失控）；
  //  b) asar 头证明主进程专用包真在归档内（有 offset 无 unpacked 标记）——
  //     防止"既没进 asar 也没落盘"的静默丢包；
  //  c) staged node.exe 离线跑通 dsh --version —— 闭包完整性的最终证据。
  if (!existsSync(CLOSURE_JSON)) {
    checks.push('SKIP 选择性解包对照 — 未跑 prepackage（build/unpack-closure.json 缺席）')
  } else {
    const nmRoot = join(unpackedRoot, 'node_modules')
    let expected = null
    try {
      expected = new Set(readJson(CLOSURE_JSON).packages)
    } catch {
      check(false, 'unpack-closure.json 可解析')
    }
    if (expected) {
      const missingUnpacked = []
      for (const name of expected) {
        if (!existsSync(join(nmRoot, ...name.split('/'), 'package.json'))) missingUnpacked.push(name)
      }
      check(
        missingUnpacked.length === 0,
        'dsh 闭包逐包落盘（对照 unpack-closure.json）',
        missingUnpacked.length > 0
          ? `缺 ${missingUnpacked.length} 个：${missingUnpacked.slice(0, 8).join(', ')}`
          : `${expected.size} 包全在位`,
      )
      const unexpectedUnpacked = []
      for (const top of readdirSync(nmRoot)) {
        if (top.startsWith('.')) continue
        const tops = top.startsWith('@')
          ? readdirSync(join(nmRoot, top)).map((d) => `${top}/${d}`)
          : [top]
        for (const t of tops) if (!expected.has(t)) unexpectedUnpacked.push(t)
      }
      check(
        unexpectedUnpacked.length === 0,
        '落盘树与生成清单完全一致（无预料外的解包包）',
        unexpectedUnpacked.length > 0
          ? `多 ${unexpectedUnpacked.length} 个：${unexpectedUnpacked.slice(0, 8).join(', ')}`
          : '文件数口径受控',
      )

      // b) asar 头解析：主进程专用包在归档内（非 unpacked），pdfjs/dist 在外
      const asarP = join(dist, 'resources', 'app.asar')
      if (existsSync(asarP)) {
        try {
          const header = readAsarHeader(asarP)
          const inAsar = (rel) => {
            let node = { files: header.files }
            for (const part of rel.split('/')) {
              node = node?.files?.[part]
              if (!node) return null
            }
            return node
          }
          const zipped = inAsar('node_modules/extract-zip/package.json')
          check(
            Boolean(zipped && !zipped.unpacked),
            '主进程专用包已收进 app.asar（extract-zip 带 offset 无 unpacked 标记）',
            '缺失或仍解包 → 选择性解包没生效，安装文件数回落',
          )
          const unpackedPdf = inAsar('node_modules/pdfjs-dist/package.json')
          check(
            Boolean(unpackedPdf?.unpacked),
            'pdfjs-dist 保留真实落盘（运行时按路径读 cmaps/standard_fonts）',
          )
          check(
            Boolean(inAsar('dist/main/index.cjs') && !inAsar('dist/main/index.cjs').unpacked),
            '主进程产物在 app.asar 归档内',
          )
        } catch (err) {
          check(false, 'app.asar 头可解析', err instanceof Error ? err.message : String(err))
        }
      }
    }

    // c) 离线闭包冒烟：staged node.exe 直接跑 unpacked 里的 dsh 入口。
    //    闭包缺一个传递依赖，这里立刻非零退出（模块解析失败）。
    const nodeExe = join(dist, 'resources', 'dsh-node', process.platform === 'win32' ? 'node.exe' : 'node')
    const dshEntry = join(nmRoot, RUNTIME, binRel)
    if (existsSync(nodeExe) && existsSync(dshEntry)) {
      const r = spawnSync(nodeExe, [dshEntry, '--version'], {
        timeout: 120_000,
        encoding: 'utf8',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      const version = (r.stdout || '').trim().split('\n')[0]
      check(
        r.status === 0 && version.length > 0,
        'dsh 闭包离线冒烟（staged node.exe 跑 dsh --version）',
        r.error
          ? `spawn 失败：${r.error}`
          : `exit ${r.status}，stdout=${version.slice(0, 40) || '(空)'} stderr=${(r.stderr || '').trim().slice(0, 80)}`,
      )
    }
  }
  console.log(
    `产物统计: ${total.files} 个文件, ${(total.bytes / 1024 / 1024).toFixed(0)} MB 解包体积`,
  )
}

/** 读 app.asar 的 JSON 头（electron/asar 的 pickle 布局：[4B][4B headerSize][4B strLen][json]）。 */
function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    readSync(fd, sizeBuf, 0, 8, 0)
    const headerSize = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    readSync(fd, headerBuf, 0, headerSize, 8)
    const strLen = headerBuf.readUInt32LE(4)
    return JSON.parse(headerBuf.slice(8, 8 + strLen).toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

console.log(`verify-dsh-package: ${checks.length - failures.length}/${checks.length} 通过`)
for (const line of checks) if (!line.startsWith('PASS')) console.log('  ' + line)
if (failures.length) {
  console.error(`\ndsh 装配门禁失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
