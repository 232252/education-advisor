// =============================================================
// scripts/after-pack-trim.mjs — electron-builder afterPack 钩子
//
// 打包后的补齐、修剪与守卫（对应 electron-builder.yml 里的 afterPack 配置）。
// 资源目录走 packager.getResourcesDir：win/linux 是 <appOutDir>/resources，
// mac 是 <appOutDir>/<Product>.app/Contents/Resources。mac 上再拼 resources
// 会把离线件写到 .app 外面，守卫也会对着空目录把整份闭包报成缺落盘。
//
//  1. 补齐 electron-builder 复制不出来的离线件（在 NSIS 打 7z 之前落盘）：
//     - vendor/dsh-im/node_modules → resources/dsh-im/node_modules。
//       builder 复制 extraResources 时整目录丢弃 node_modules，而连接中心
//       首开离线靠它（qrcode 标记检测，im-host.ts ensurePluginDeps）。
//     - node_modules/pnpm/dist/node_modules → app.asar.unpacked 里 pnpm 的
//       同名目录。builder 复制模块树时无条件跳过嵌套 node_modules
//       （NodeModuleCopyHelper），缺了它 pnpm.mjs 引导壳起不来。
//     - build/office-kit/*.zip → resources/office-kit/（win）：office 转 PDF
//       组件随包只带 zip（首用本地解压，office-kit-service.ts），单文件落盘
//       替代旧预解压的 735 文件/184MB。走钩子不走 extraResources，免得
//       mac/linux 构建被缺目录卡死。
//  2. 删 dxcompiler.dll（WebGPU/Dawn 的着色器编译器，~25MB）—— 应用与
//     连接中心的 WebContentsView 都不用 WebGPU，删掉不影响渲染。
//     vk_swiftshader.dll 保留：无 GPU / 远程桌面时它还是软件 WebGL 兜底。
//  3. win 构建删 resources/eaa-binaries/ 里其他平台的目录（extraResources
//     的 filter 不分平台，win 包只需 win32-x64）；删依赖包里其他平台的
//     原生 prebuilds 与源码编译原料（npmRebuild:false 下无用）。
//  3c. node_modules junk 大扫除（第三轮瘦身，文件数优先）：对主树与
//     dsh-im 树删"非运行文件"——*.d.ts、非 README/CHANGELOG 的 *.md、
//     构建配置散件、examples/、非声明 *.ts；LICENSE/COPYING/NOTICE 先
//     聚合进 resources/THIRD-PARTY-NOTICES.txt 再删（法律合规保留文本），
//     根目录 LICENSES.chromium.html（5.4MB，运行时无进程读）同样并入。
//     @deepseek-ai（黑盒 SDK 运行时读自己的 yml/md/docs）等保护树一刀不碰。
//  4. 守卫断言（配置改坏在这里拦，别等装到教师机）：
//     - 三个离线复制确实落位（qrcode 标记 / pnpm dist / kit zip）
//     - locales 只剩 electronLanguages 白名单里的 .pak
//     - files 负向排除的大件确实不在 app.asar.unpacked 里
//     - 选择性解包红线（第四轮）：对照 build/unpack-closure.json，dsh 闭包
//       每个包真实落盘、解包树里没有预料外的包（smartUnpack 预料外的整包
//       解包会悄悄放大安装文件数）；sweep 后保护树外无 *.d.ts 残留
//
// 退出方式：守卫失败直接 process.exit(1) 让打包失败 —— afterPack 抛错时
// electron-builder 也会中止，但手动 exit 的日志更醒目。
// =============================================================

import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** electron-builder.yml electronLanguages 的单一事实来源（改那边同步改这里）。 */
const KEEP_LANGS = new Set(['zh-CN.pak', 'en-US.pak'])

/**
 * electron-builder 的资源目录：
 *   windows / linux: <appOutDir>/resources
 *   mac: <appOutDir>/<Product>.app/Contents/Resources
 * mac 的 appOutDir 是 .app 的父目录。再拼一层 resources 会把 dsh-im、pnpm
 * dist、THIRD-PARTY-NOTICES 写到包外，守卫也对着空目录报「闭包缺落盘」。
 * 优先 packager.getResourcesDir，和打包器写盘用同一条路径。
 */
export function packagedResourcesDir(appOutDir, packager) {
  if (packager && typeof packager.getResourcesDir === 'function') {
    return packager.getResourcesDir(appOutDir)
  }
  const platform = packager?.platform?.name
  if (platform === 'mac') {
    const productFilename = packager?.appInfo?.productFilename
    if (!productFilename) {
      throw new Error('[after-pack-trim] mac 打包缺少 productFilename，无法定位 Contents/Resources')
    }
    return join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }
  return join(appOutDir, 'resources')
}

/**
 * win/linux 的 Electron locale 是 <appOutDir>/locales/*.pak，和 resources 同级，
 * 不在 resources 里面。mac 用 .lproj（Contents/Resources 与 Electron Framework），
 * electronLanguages 在 afterPack 之前已经滤过，不能拿 *.pak 白名单去套。
 */
export function packagedLocalesDir(appOutDir, platformName) {
  if (platformName === 'mac') return null
  return join(appOutDir, 'locales')
}

/** win/linux 在可执行文件旁边；mac 上 electron-builder 把它移进 Contents/Resources。 */
export function chromiumLicenseCandidates(appOutDir, resourcesDir) {
  return [join(appOutDir, 'LICENSES.chromium.html'), join(resourcesDir, 'LICENSES.chromium.html')]
}

/**
 * 对照期望清单看 app.asar.unpacked/node_modules：缺 package.json 的是没落盘，
 * 目录里多出来的是 smartUnpack 整包解出但清单没记账。
 */
export function diffUnpackedPackages(unpackedDir, expectedNames) {
  const expected = expectedNames instanceof Set ? expectedNames : new Set(expectedNames)
  const missing = []
  for (const name of expected) {
    if (!existsSync(join(unpackedDir, ...name.split('/'), 'package.json'))) missing.push(name)
  }
  const unexpected = []
  if (!existsSync(unpackedDir)) return { missing, unexpected }
  for (const top of readdirSync(unpackedDir)) {
    if (top.startsWith('.')) continue
    const tops = top.startsWith('@') ? readdirSync(join(unpackedDir, top)).map((d) => `${top}/${d}`) : [top]
    for (const t of tops) {
      if (!expected.has(t)) unexpected.push(t)
    }
  }
  return { missing, unexpected }
}

/** files 负向过滤的大件：出现在 unpacked 树里即说明排除配置被改坏。 */
const EXCLUDED_IN_UNPACKED = [
  'pnpm/pnpm.exe',
  '@deepseek-ai/dsh-experimental-inspector',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  '@deepseek-ai/dsh-experimental-liveshare',
  '@deepseek-ai/dsh-experimental-client-ui-forge',
  'sherpa-onnx-win-x64',
  // libreoffice-kit 改随包 zip（resources/office-kit/），不再预解压进包
  '@deepseek-ai/libreoffice-kit-win32-x64',
  // 字体三包（构建期依赖，vite 发射进 dist 后包体不再被引用）
  'lxgw-wenkai-webfont',
  '@fontsource/jetbrains-mono',
  '@fontsource-variable/inter',
]

// ---- 3c. junk 大扫除的规则常量 ----
// 保护清单：整个包一刀不碰。@deepseek-ai 是黑盒 SDK（运行时读自己的
// yml/md/docs，闭包安全网只核对依赖不核对文件读取）；@earendil-works 是
// vendored pi-ai（有意保留的 HTTP 层）；pnpm 的引导链自检文件；pdfjs-dist
// 的 cmaps/standard_fonts 运行时按路径读；typescript 防它进了生产依赖后被删 lib。
const PROTECTED_SCOPES = new Set(['@deepseek-ai', '@earendil-works'])
const PROTECTED_PKGS = new Set(['pnpm', 'pdfjs-dist', 'typescript'])
const EXAMPLE_DIRS = new Set(['examples', 'example', '__mocks__', '.github', '.vscode', '.idea'])
const LICENSE_BASENAME_RE = /^(licen[cs]e|copying|notice|patents)/i
// LICENSE 家族里混着 notice.js / LICENSE.json 这类同名代码文件，只收文本形态
const LICENSE_EXT_DENY_RE = /\.(js|mjs|cjs|ts|mts|cts|tsx|jsx|json|map)$/i
const TSCONFIG_RE = /^tsconfig(\..+)?\.json$/
const LINTCFG_RE = /^(\.eslintrc|\.prettierrc|\.babelrc|\.stylelintrc)/
const DECLARATION_EXTS = ['.d.ts', '.d.mts', '.d.cts']
const TS_EXTS = ['.ts', '.mts', '.cts', '.tsx']

/** Node 运行时会用的 exports 条件；development/browser/bun 等只在构建期生效。 */
const RUNTIME_EXPORT_CONDITIONS = new Set(['require', 'import', 'default', 'node', 'node-addons'])

/** 包的运行时入口（main/exports 的运行时条件分支）是否直接指向 .ts 源码。 */
function packageWantsTs(pkgDir) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  } catch {
    return false
  }
  const hits = []
  const walkExports = (value) => {
    if (typeof value === 'string') {
      hits.push(value)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, sub] of Object.entries(value)) {
      if (key === 'types' || key === 'typings') continue
      // 条件键只放行 Node 运行时认的；子路径键（./xxx）继续下钻
      if (RUNTIME_EXPORT_CONDITIONS.has(key) || key.startsWith('./') || key.startsWith('#')) walkExports(sub)
    }
  }
  if (typeof pkg.main === 'string') hits.push(pkg.main)
  walkExports(pkg.exports)
  return hits.some((s) => TS_EXTS.some((ext) => s.endsWith(ext)))
}

/** 相对 node_modules 根的路径段是否落在保护包里（顶层 / @scope 两级判定）。 */
function isProtectedPath(parts) {
  if (parts.length === 0) return false
  if (parts[0].startsWith('@')) {
    return PROTECTED_SCOPES.has(parts[0]) || PROTECTED_PKGS.has(`${parts[0]}/${parts[1] ?? ''}`)
  }
  return PROTECTED_PKGS.has(parts[0])
}

export default async function afterPack(context) {
  const appOutDir = context.appOutDir
  const platform = context.packager.platform.name // 'windows' | 'mac' | 'linux'
  const resourcesDir = packagedResourcesDir(appOutDir, context.packager)
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
  const imDepsDest = join(resourcesDir, 'dsh-im', 'node_modules')
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
  const pnpmDistDest = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'pnpm', 'dist', 'node_modules')
  copyDir(pnpmDistSrc, pnpmDistDest, null, 'pnpm dist 嵌套依赖（pnpm.mjs 引导壳需要）')
  if (!existsSync(join(pnpmDistDest, 'get-pnpm', 'package.json'))) {
    console.error(`[after-pack-trim] pnpm dist 落位失败：缺 ${join(pnpmDistDest, 'get-pnpm')}`)
    process.exit(1)
  }

  // ---- 2. WebGPU 着色器编译器（所有平台都不用）----
  remove(join(appOutDir, 'dxcompiler.dll'), 'dxcompiler.dll（WebGPU 未用）')

  // 1c. office 转 PDF 组件随包 zip（win）：单文件落盘替代旧预解压的
  //     735 文件/184MB。缺 zip = 没跑 prepackage，直接失败。
  if (platform === 'windows') {
    const kitZipDir = join(ROOT, 'build', 'office-kit')
    const kitZips = existsSync(kitZipDir) ? readdirSync(kitZipDir).filter((n) => n.endsWith('.zip')) : []
    if (kitZips.length !== 1) {
      console.error(
        `[after-pack-trim] build/office-kit/ 应恰有 1 个 zip，实际 ${kitZips.length} —— 先跑 npm run prepackage`,
      )
      process.exit(1)
    }
    const kitDest = join(resourcesDir, 'office-kit')
    mkdirSync(kitDest, { recursive: true })
    cpSync(join(kitZipDir, kitZips[0]), join(kitDest, kitZips[0]))
    console.log(
      `[after-pack-trim] +${(statSync(join(kitDest, kitZips[0])).size / 1024 / 1024).toFixed(1)}MB office-kit 随包 zip（首用本地解压，office-kit-service）`,
    )
  }

  // ---- 3. 只面向本平台产物的修剪 ----
  // 3a. win 包不带其他平台的 eaa 二进制
  if (platform === 'windows') {
    const binRoot = join(resourcesDir, 'eaa-binaries')
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
  const unpacked = join(resourcesDir, 'app.asar.unpacked', 'node_modules')
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

  // ---- 3c. node_modules junk 大扫除（主树 + dsh-im 树同一套规则）----
  const sweepCounts = { dts: 0, md: 0, ts: 0, cfg: 0, exampleDirs: 0, license: 0 }
  let sweptBytes = 0
  const notices = [] // { source, content } — LICENSE 聚合原料
  const tsWantsCache = new Map() // 包根目录 -> 运行时入口指向 .ts？

  // 根目录 LICENSES.chromium.html（5.4MB 纯文本，运行时无进程读它）并入
  // THIRD-PARTY-NOTICES.txt 一起分发：合规文本保留、散文件少一个。
  const chromiumLicenses = chromiumLicenseCandidates(appOutDir, resourcesDir).find((p) => existsSync(p))
  if (chromiumLicenses) {
    notices.push({
      source: 'Electron (Chromium) — LICENSES.chromium.html',
      content: readFileSync(chromiumLicenses, 'utf8'),
    })
    remove(chromiumLicenses, 'LICENSES.chromium.html（并入 THIRD-PARTY-NOTICES.txt）')
  }

  // 从文件所在目录向上找最近的有 package.json 的目录（即包根），判断该包
  // 是否要在 .ts 规则上保守豁免。实践中 0 个包命中（2026-11-11 全量核对），
  // 这是防未来依赖形态变化的保险丝。
  const packageRootOf = (fileDir, nmRoot) => {
    let dir = fileDir
    while (dir.startsWith(nmRoot)) {
      if (tsWantsCache.has(dir)) return dir
      if (existsSync(join(dir, 'package.json'))) {
        tsWantsCache.set(dir, packageWantsTs(dir))
        return dir
      }
      if (dir === nmRoot) break
      dir = dirname(dir)
    }
    return null
  }

  const sweepTree = (nmRoot, label) => {
    if (!existsSync(nmRoot)) return
    const walk = (dir, parts) => {
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const name of entries) {
        const p = join(dir, name)
        const nextParts = [...parts, name]
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          if (isProtectedPath(nextParts)) continue
          if (EXAMPLE_DIRS.has(name)) {
            sweptBytes += dirSize(p)
            rmSync(p, { recursive: true, force: true })
            sweepCounts.exampleDirs += 1
            continue
          }
          walk(p, nextParts)
          continue
        }
        if (isProtectedPath(nextParts)) continue
        const deleteFile = () => {
          sweptBytes += st.size
          rmSync(p, { force: true })
        }
        if (DECLARATION_EXTS.some((ext) => name.endsWith(ext))) {
          deleteFile()
          sweepCounts.dts += 1
        } else if (name.endsWith('.md') && !/^(readme|changelog)/i.test(name)) {
          // dsh 体系把 docs/*.md 当 AI 技能说明书——保护清单外才删
          deleteFile()
          sweepCounts.md += 1
        } else if (name.endsWith('.map')) {
          deleteFile() // builder 层应已排除；漏网兜底
          sweepCounts.cfg += 1
        } else if (TSCONFIG_RE.test(name) || LINTCFG_RE.test(name)) {
          deleteFile()
          sweepCounts.cfg += 1
        } else if (TS_EXTS.some((ext) => name.endsWith(ext))) {
          const pkgRoot = packageRootOf(dir, nmRoot)
          if (pkgRoot && tsWantsCache.get(pkgRoot)) continue // 运行时入口指向 .ts 的包保守豁免
          deleteFile()
          sweepCounts.ts += 1
        } else if (LICENSE_BASENAME_RE.test(name) && !LICENSE_EXT_DENY_RE.test(name)) {
          // 用同一次打开的句柄读正文，避免 stat 之后再按路径读（文件可能已消失）。
          let fd
          let content
          try {
            fd = openSync(p, 'r')
            content = readFileSync(fd, 'utf8')
          } catch {
            if (fd !== undefined) closeSync(fd)
            continue
          }
          closeSync(fd)
          notices.push({ source: `${label}/${relative(nmRoot, p).split(sep).join('/')}`, content })
          deleteFile()
          sweepCounts.license += 1
        }
      }
    }
    walk(nmRoot, [])
    // 空目录修剪（package.json 都还在，包根不会是空的；保护树跳过——
    // 包内可能存在刻意留空的运行时目录）
    pruneEmptyDirs(nmRoot, [])
  }

  sweepTree(unpacked, 'node_modules')
  sweepTree(imDepsDest, 'dsh-im/node_modules')

  if (notices.length > 0) {
    const target = join(resourcesDir, 'THIRD-PARTY-NOTICES.txt')
    const header =
      '第三方许可汇总（THIRD-PARTY NOTICES）\n\n' +
      '本文件由 scripts/after-pack-trim.mjs 打包时自动聚合生成：随包依赖的\n' +
      'LICENSE / COPYING / NOTICE 文本合并于此，替换包内上千个散落的许可文件。\n'
    writeFileSync(
      target,
      header +
        notices
          .map((n) => `\n${'='.repeat(72)}\n来源: ${n.source}\n${'='.repeat(72)}\n\n${n.content.trim()}\n`)
          .join('\n'),
    )
    console.log(
      `[after-pack-trim] LICENSE 聚合：${notices.length} 个许可文件 → resources/THIRD-PARTY-NOTICES.txt`,
    )
  }
  console.log(
    `[after-pack-trim] junk 大扫除：d.ts ${sweepCounts.dts} / md ${sweepCounts.md} / ts ${sweepCounts.ts} / 配置 ${sweepCounts.cfg} / examples 目录 ${sweepCounts.exampleDirs} / LICENSE→聚合 ${sweepCounts.license}，-${(sweptBytes / 1024 / 1024).toFixed(1)}MB`,
  )

  // ---- 4. 守卫断言 ----
  // 4a. locales 白名单
  const localesDir = packagedLocalesDir(appOutDir, platform)
  if (localesDir && existsSync(localesDir)) {
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

  // 4c. 选择性解包红线核查（第四轮安装提速，读 prepackage 生成的对照清单）：
  //  - build/unpack-closure.json 必须在（没跑 prepackage 直接失败，别带着空
  //    asarUnpack 清单出货——那会把 dsh 子进程的依赖全关进 asar）。
  //  - 期望落盘的每个包（dsh 闭包 + pnpm 工具链 + pdfjs-dist）：包根
  //    package.json 必须真实存在 —— dsh 子进程看不见 asar，缺一个就断链。
  //  - 解包树里出现的每个包都必须在期望清单里：smartUnpack 预料外的整包
  //    解包、或生成器与 files 过滤不同步，都会悄悄放大安装文件数。
  //  - sweep 后保护树外不得残留 *.d.ts（规则失效检查，保留）。
  const closureJsonPath = join(ROOT, 'build', 'unpack-closure.json')
  if (!existsSync(closureJsonPath)) {
    console.error(
      '[after-pack-trim] 缺 build/unpack-closure.json —— 先跑 npm run prepackage（生成 asarUnpack 闭包清单）',
    )
    process.exit(1)
  }
  const expectedUnpacked = new Set(JSON.parse(readFileSync(closureJsonPath, 'utf8')).packages)
  const { missing: missingUnpacked, unexpected: unexpectedUnpacked } = diffUnpackedPackages(unpacked, expectedUnpacked)
  if (missingUnpacked.length > 0) {
    console.error(
      `[after-pack-trim] dsh 闭包/保留包缺落盘（asarUnpack 或 files 配置坏了？共 ${missingUnpacked.length} 个）：\n  ${missingUnpacked.slice(0, 20).join('\n  ')}`,
    )
    process.exit(1)
  }
  if (unexpectedUnpacked.length > 0) {
    console.error(
      `[after-pack-trim] 预料外的解包包（smartUnpack 整包解包或清单不同步，会放大安装文件数；在 compute-unpack-closure.mjs 里补账目）：\n  ${unexpectedUnpacked.slice(0, 30).join('\n  ')}`,
    )
    process.exit(1)
  }

  // 4c-bis. dsh-im 树的包根 package.json 全在位（sweep 过删红线，模块解析命脉）。
  let pkgJsonMissing = []
  for (const top of readdirSync(imDepsDest)) {
    if (top.startsWith('.')) continue
    const tops = top.startsWith('@') ? readdirSync(join(imDepsDest, top)).map((d) => join(top, d)) : [top]
    for (const t of tops) {
      if (!existsSync(join(imDepsDest, t, 'package.json'))) pkgJsonMissing.push(`dsh-im/node_modules/${t.split(sep).join('/')}`)
    }
  }
  if (pkgJsonMissing.length > 0) {
    console.error(`[after-pack-trim] 包根 package.json 缺失（sweep 过删？）：\n  ${pkgJsonMissing.join('\n  ')}`)
    process.exit(1)
  }
  let dtsResidue = 0
  const countDts = (dir, protectedScope) => {
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
        const next = [...protectedScope, name]
        if (next.length <= 2 && (name.startsWith('@') ? PROTECTED_SCOPES.has(name) : PROTECTED_PKGS.has(name))) continue
        countDts(p, next)
      } else if (DECLARATION_EXTS.some((ext) => name.endsWith(ext))) {
        dtsResidue += 1
      }
    }
  }
  countDts(unpacked, [])
  countDts(imDepsDest, [])
  if (dtsResidue > 0) {
    console.error(`[after-pack-trim] 保护树外残留 ${dtsResidue} 个 *.d.ts —— sweep 规则失效，中止打包`)
    process.exit(1)
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

/** 自底向上删除 sweep 留下的空目录（保护树整枝跳过；根不动）。 */
function pruneEmptyDirs(dir, parts) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const p = join(dir, name)
    const nextParts = [...parts, name]
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (isProtectedPath(nextParts)) continue
    pruneEmptyDirs(p, nextParts)
    let rest
    try {
      rest = readdirSync(p)
    } catch {
      continue
    }
    if (rest.length === 0) rmSync(p, { recursive: true, force: true })
  }
}
