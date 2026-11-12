// =============================================================
// scripts/after-pack-trim.mjs — electron-builder afterPack 钩子
//
// 打包后的补齐、修剪与守卫（对应 electron-builder.yml 里的 afterPack 配置）。
// 资源目录走 packager.getResourcesDir：win/linux 是 <appOutDir>/resources，
// mac 是 <appOutDir>/<Product>.app/Contents/Resources。mac 上再拼 resources
// 会把离线件写到 .app 外面，守卫也会对着空目录把整份闭包报成缺落盘。
//
//  1. 在 NSIS 打 7z 之前把 prepackage 的归档复制进 resources（缺了就失败，
//     不许退回散文件树）：
//     - build/dsh-runtime/dsh-runtime.zip → resources/dsh-runtime/
//     - build/dsh-im/dsh-im.zip → resources/dsh-im/
//     - build/office-kit/*.zip → resources/office-kit/（仅 win，恰有 1 个）。
//       office 转 PDF 仍是这一个 deflate zip，首用再解到 userData。
//     教师包不含 pnpm / @pnpm/exe。runtime zip 里出现它们，或体积超过
//     scripts/lib/pack-budget.mjs 的预算，这里直接失败。unpacked 里若还
//     有 pnpm 目录，同样失败，不要再把工具链复制进去。
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
//     - runtime / dsh-im / office-kit 归档落位，且 runtime zip 不含工具链
//     - locales 只剩 electronLanguages 白名单里的 .pak
//     - files 负向排除的大件确实不在 app.asar.unpacked 里
//     - app.asar.unpacked 只留原生文件（上限 800）。dsh 闭包在 runtime zip
//       里，不在这里。sweep 后保护树外无 *.d.ts 残留
//
// 退出方式：守卫失败直接 process.exit(1) 让打包失败 —— afterPack 抛错时
// electron-builder 也会中止，但手动 exit 的日志更醒目。
// =============================================================

import { closeSync, cpSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { assertMainProcessModulesPresent } from './lib/asar-main-requires.mjs'
import { inspectResources, logInventory, RUNTIME_ZIP_MAX_BYTES, toolchainZipHits } from './lib/pack-budget.mjs'
import { firstZipMethod } from './lib/store-zip.mjs'
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

  // 1a. dsh-im 与 dsh runtime 各一个 STORE zip（NSIS 写两个大文件，首启再解到 userData）。
  //     不要把 vendor/dsh-im/node_modules 抄成散文件。
  const copyZip = (srcDir, destDir, asset, why) => {
    const src = join(srcDir, asset)
    if (!existsSync(src)) {
      console.error(`[after-pack-trim] 缺少 ${src}（先跑 prepackage 的 build-dsh-archives）`)
      process.exit(1)
    }
    mkdirSync(destDir, { recursive: true })
    cpSync(src, join(destDir, asset))
    console.log(`[after-pack-trim] +${(statSync(src).size / 1024 / 1024).toFixed(1)}MB ${why}`)
  }
  copyZip(join(ROOT, 'build', 'dsh-runtime'), join(resourcesDir, 'dsh-runtime'), 'dsh-runtime.zip', 'dsh runtime 闭包（含 dsh-scope 等 peer）')
  copyZip(join(ROOT, 'build', 'dsh-im'), join(resourcesDir, 'dsh-im'), 'dsh-im.zip', '连接中心 dsh-im')
  const { listZipEntries } = await import('./lib/store-zip.mjs')
  const runtimeEntries = new Set(listZipEntries(join(resourcesDir, 'dsh-runtime', 'dsh-runtime.zip')))
  if (!runtimeEntries.has('node_modules/@deepseek-ai/dsh-scope/package.json')) {
    console.error('[after-pack-trim] runtime zip 缺少 @deepseek-ai/dsh-scope')
    process.exit(1)
  }
  const pnpmHits = toolchainZipHits(runtimeEntries)
  if (pnpmHits.length > 0) {
    console.error(`[after-pack-trim] runtime zip 不应含 pnpm / @pnpm/exe: ${pnpmHits.slice(0, 8).join(', ')}`)
    process.exit(1)
  }
  const runtimeZipPath = join(resourcesDir, 'dsh-runtime', 'dsh-runtime.zip')
  const runtimeBytes = statSync(runtimeZipPath).size
  const runtimeMethod = firstZipMethod(runtimeZipPath)
  if (runtimeMethod !== 0) {
    console.error(
      `[after-pack-trim] dsh-runtime.zip method=${runtimeMethod}，必须是 STORE (0)。不要先压缩再交给 NSIS。`,
    )
    process.exit(1)
  }
  if (runtimeBytes > RUNTIME_ZIP_MAX_BYTES) {
    console.error(
      `[after-pack-trim] dsh-runtime.zip ${runtimeBytes} bytes exceeds ${RUNTIME_ZIP_MAX_BYTES}`,
    )
    process.exit(1)
  }
  const imZipPath = join(resourcesDir, 'dsh-im', 'dsh-im.zip')
  const imMethod = firstZipMethod(imZipPath)
  if (imMethod !== 0) {
    console.error(`[after-pack-trim] dsh-im.zip method=${imMethod}，必须是 STORE (0)。`)
    process.exit(1)
  }
  const imEntries = new Set(listZipEntries(join(resourcesDir, 'dsh-im', 'dsh-im.zip')))
  if (!imEntries.has('node_modules/qrcode/package.json')) {
    console.error('[after-pack-trim] dsh-im zip 缺少 qrcode')
    process.exit(1)
  }

  // 1b. 教师安装目录不带 pnpm 工具链。目录还在，说明 files 排除被改掉了。
  //     不要把 node_modules/pnpm/dist 再复制进来。
  const pnpmUnpacked = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'pnpm')
  const pnpmExeUnpacked = join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@pnpm')
  if (existsSync(pnpmUnpacked) || existsSync(pnpmExeUnpacked)) {
    console.error('[after-pack-trim] 教师包不应含 pnpm / @pnpm（app.asar.unpacked）。不要把工具链复制进安装目录。')
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
        // 先打开再 fstat。Windows 打不开目录，那种失败才退回 stat，只用来决定要不要往下走。
        let fd
        let st
        try {
          fd = openSync(p, 'r')
          st = fstatSync(fd)
        } catch {
          if (fd !== undefined) closeSync(fd)
          fd = undefined
          try {
            st = statSync(p)
          } catch {
            continue
          }
          if (!st.isDirectory()) continue
        }
        if (st.isDirectory()) {
          if (fd !== undefined) closeSync(fd)
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
        const isProtected = isProtectedPath(nextParts)
        const isDts = DECLARATION_EXTS.some((ext) => name.endsWith(ext))
        const isMd = name.endsWith('.md') && !/^(readme|changelog)/i.test(name)
        const isMap = name.endsWith('.map')
        const isCfg = TSCONFIG_RE.test(name) || LINTCFG_RE.test(name)
        const isTs = TS_EXTS.some((ext) => name.endsWith(ext))
        const tsPkgRoot = isTs ? packageRootOf(dir, nmRoot) : null
        const tsExempt = Boolean(tsPkgRoot && tsWantsCache.get(tsPkgRoot))
        // 分类顺序与原来的 if/else 一致：.md / .d.ts 先于 LICENSE 文件名。
        const isLicense =
          !isDts &&
          !isMd &&
          !isMap &&
          !isCfg &&
          !isTs &&
          LICENSE_BASENAME_RE.test(name) &&
          !LICENSE_EXT_DENY_RE.test(name)
        let licenseText
        try {
          if (!isProtected && isLicense) licenseText = readFileSync(fd, 'utf8')
        } finally {
          closeSync(fd)
        }
        if (isProtected) continue
        const deleteFile = () => {
          sweptBytes += st.size
          rmSync(p, { force: true })
        }
        if (isDts) {
          deleteFile()
          sweepCounts.dts += 1
        } else if (isMd) {
          // dsh 体系把 docs/*.md 当 AI 技能说明书——保护清单外才删
          deleteFile()
          sweepCounts.md += 1
        } else if (isMap) {
          deleteFile() // builder 层应已排除；漏网兜底
          sweepCounts.cfg += 1
        } else if (isCfg) {
          deleteFile()
          sweepCounts.cfg += 1
        } else if (isTs) {
          if (tsExempt) continue // 运行时入口指向 .ts 的包保守豁免
          deleteFile()
          sweepCounts.ts += 1
        } else if (licenseText !== undefined) {
          notices.push({ source: `${label}/${relative(nmRoot, p).split(sep).join('/')}`, content: licenseText })
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

  // 4c. 解包树只能是原生文件。dsh 闭包在 runtime zip 里，不在这里。
  const countFiles = (dir) => {
    let n = 0
    const walk = (d) => {
      let entries
      try {
        entries = readdirSync(d)
      } catch {
        return
      }
      for (const name of entries) {
        const p = join(d, name)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) walk(p)
        else n += 1
      }
    }
    walk(dir)
    return n
  }
  const unpackedFiles = existsSync(unpacked) ? countFiles(unpacked) : 0
  if (unpackedFiles > 800) {
    console.error(`[after-pack-trim] app.asar.unpacked 有 ${unpackedFiles} 个文件（上限 800）。闭包又被解成散文件了？`)
    process.exit(1)
  }
  if (existsSync(join(unpacked, '@deepseek-ai', 'dsh-scope'))) {
    console.error('[after-pack-trim] dsh-scope 出现在 unpacked。peer 包必须只在 runtime zip 里')
    process.exit(1)
  }

  // 4c-bis. 解包树里的包根 package.json 仍要在（sweep 不许删到包根）。
  let pkgJsonMissing = []
  if (existsSync(unpacked)) {
    for (const top of readdirSync(unpacked)) {
      if (top.startsWith('.')) continue
      const topPath = join(unpacked, top)
      if (!statSync(topPath).isDirectory()) continue
      const tops = top.startsWith('@') ? readdirSync(topPath).map((d) => join(top, d)) : [top]
      for (const t of tops) {
        if (!existsSync(join(unpacked, t, 'package.json'))) pkgJsonMissing.push(t.split(sep).join('/'))
      }
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
  if (dtsResidue > 0) {
    console.error(`[after-pack-trim] 保护树外残留 ${dtsResidue} 个 *.d.ts —— sweep 规则失效，中止打包`)
    process.exit(1)
  }

  assertMainProcessModulesPresent(resourcesDir)

  const packed = inspectResources(resourcesDir, { requireComplete: platform === 'windows' })
  logInventory('afterPack', packed.rows)
  if (packed.failures.length > 0) {
    for (const failure of packed.failures) console.error(`[pack-budget] FAIL ${failure}`)
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
