// =============================================================
// 不调用官方 `dsh plugin add`，直接把 link: 插件写进 profile。
//
// 教师机不再随包 pnpm。官方 plugin add 会跑 pnpm，改 package.json、
// pnpm-lock.yaml，并在 node_modules 里建 junction/符号链接。
// `dsh web` / sdk 启动时只看两件事：
//   1. profiles/<name>/package.json 的 dsh.profile.bundles
//   2. 从该 profile 目录按 Node 查找规则能解析到 node_modules/<包名>/package.json
// 所以在打包路径或解压路径上重写依赖说明符、补上链接，就够把连接中心
// 和教育工具装进已有（或新建）的 profile，不必再唤起 pnpm。
//
// 只信 stamp 会踩坑：旧安装把 @xmanrui/dsh-im 链到安装目录里的
// resources/dsh-im，升级成 zip 首启解压后，真正的树在
// userData/dsh-bundles/dsh-im，stamp 仍是 5.10.0+panel1，面板就
// 回落到官方 Harness 首页。这里在采纳 stamp 之前先核对链接目标。
// =============================================================

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { dshPluginLinkSpec } from './im-url'

/** 与官方 PROFILE_TEMPLATES 一致：新建 profile 时垫上的官方层。 */
export const OFFICIAL_PROFILE_BUNDLES: Record<string, readonly string[]> = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  sdk: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'],
}

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

export interface LinkedPlugin {
  /** 插件根目录（内有 package.json）。 */
  dir: string
}

export interface ProfileLinkOptions {
  home: string
  profile: string
  plugins: readonly LinkedPlugin[]
}

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  [key: string]: unknown
}

export function resolveDshProfileDir(home: string, profile: string): string {
  return join(home, 'profiles', profile)
}

/** 读插件 package.json 的 name；没有就用目录名。 */
export function readPluginPackageName(dir: string): string {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`找不到插件目录：${dir}`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
  const fallback = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'plugin'
  return pkg.name ?? fallback
}

export function parseLinkDir(spec: string | undefined): string | null {
  if (!spec || !spec.startsWith('link:')) return null
  return spec.slice('link:'.length)
}

export function sameDir(a: string, b: string): boolean {
  const left = normalizeDir(a)
  const right = normalizeDir(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function normalizeDir(path: string): string {
  return resolve(path).replace(/[\\/]+$/, '').split(/[\\/]/).join('/')
}

/** profile 清单里的 link: 与 node_modules 链接都指向当前目录时为 true。 */
export function profileLinksCurrent(opts: ProfileLinkOptions): boolean {
  const profileDir = resolveDshProfileDir(opts.home, opts.profile)
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return false
  let manifest: ProfileManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
  } catch {
    return false
  }
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  for (const plugin of opts.plugins) {
    const name = readPluginPackageName(plugin.dir)
    const expected = resolve(plugin.dir)
    const linked = parseLinkDir(deps[name])
    if (!linked || !sameDir(linked, expected)) return false
    if (!bundles.includes(name)) return false
    const moduleDir = packageModuleDir(profileDir, name)
    if (!moduleLinkPointsTo(moduleDir, expected)) return false
  }
  return true
}

/**
 * 把一组 link: 插件写进 profile：必要时建骨架，改 package.json，
 * 重做 node_modules 链接。已就位的条目保持不动。
 */
export function materializeProfileLinks(opts: ProfileLinkOptions): void {
  const profileDir = resolveDshProfileDir(opts.home, opts.profile)
  mkdirSync(profileDir, { recursive: true })
  ensureProfileSkeleton(profileDir, opts.profile)
  const manifest = readManifest(profileDir)
  const deps = { ...(manifest.dependencies ?? {}) }
  const official = OFFICIAL_PROFILE_BUNDLES[opts.profile] ?? []
  let bundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? [...(manifest.dsh?.profile?.bundles as string[])]
    : []
  if (bundles.length === 0) bundles = [...official]
  else {
    const missing = official.filter((name) => !bundles.includes(name))
    if (missing.length > 0) bundles = [...missing, ...bundles]
  }
  for (const plugin of opts.plugins) {
    const name = readPluginPackageName(plugin.dir)
    const dir = resolve(plugin.dir)
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`找不到插件目录：${dir}`)
    deps[name] = dshPluginLinkSpec(dir)
    if (!bundles.includes(name)) bundles.push(name)
    ensureModuleLink(profileDir, name, dir)
  }
  manifest.dependencies = deps
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  writeManifest(profileDir, manifest)
}

function ensureProfileSkeleton(profileDir: string, profile: string): void {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    const official = OFFICIAL_PROFILE_BUNDLES[profile] ?? []
    const manifest: ProfileManifest = {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...official] } },
    }
    writeManifest(profileDir, manifest)
  }
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE, 'utf8')
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE, 'utf8')
}

function readManifest(profileDir: string): ProfileManifest {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as ProfileManifest
}

function writeManifest(profileDir: string, manifest: ProfileManifest): void {
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
}

export function packageModuleDir(profileDir: string, packageName: string): string {
  return join(profileDir, 'node_modules', ...packageName.split('/'))
}

function moduleLinkPointsTo(moduleDir: string, expected: string): boolean {
  if (!existsSync(join(moduleDir, 'package.json'))) return false
  try {
    return sameDir(realpathSync(moduleDir), expected)
  } catch {
    return false
  }
}

function ensureModuleLink(profileDir: string, packageName: string, targetDir: string): void {
  const moduleDir = packageModuleDir(profileDir, packageName)
  if (moduleLinkPointsTo(moduleDir, targetDir)) return
  mkdirSync(dirname(moduleDir), { recursive: true })
  removeLinkOrDir(moduleDir)
  const abs = resolve(targetDir)
  if (process.platform === 'win32') symlinkSync(abs, moduleDir, 'junction')
  else symlinkSync(abs, moduleDir, 'dir')
}

/** 只拆掉链接或本目录，不跟随 junction 去删插件本体。 */
function removeLinkOrDir(path: string): void {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return
  }
  if (st.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  rmSync(path, { recursive: true, force: true })
}

/** 给测试和诊断用：当前 node_modules 链接解析到的目录。 */
export function resolvedModuleDir(profileDir: string, packageName: string): string | null {
  const moduleDir = packageModuleDir(profileDir, packageName)
  try {
    if (!existsSync(join(moduleDir, 'package.json'))) return null
    return realpathSync(moduleDir)
  } catch {
    return null
  }
}

