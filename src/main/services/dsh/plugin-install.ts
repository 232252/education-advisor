// =============================================================
// 把 vendor/eaa-tools 用 link: 装进某个 profile。
//
// 插件自己不带学生数据。宿主起本机工具端点后，把地址和令牌放进
// 子进程环境；插件没看到地址就保持关闭。
//
// 教师机没有 pnpm，不能走官方 `dsh plugin add`。这里直接改写
// profile 的 package.json 和 node_modules 链接，目标必须是当前
// 随包或解压路径（不是开发机上的 vendor/ 仓库路径）。
// =============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EAA_PLUGINS } from './eaa-tools-contract'
import { materializeProfileLinks, profileLinksCurrent } from './plugin-links'

/** 不是 MCP 工具组、但仍按官方 bundle 链进 profile 的包（与 eaa-tools 同级目录）。 */
export const EAA_LINK_ONLY_BUNDLES = ['eaa-llm-providers'] as const

interface PluginTarget {
  home: string
  toolsDir: string
  dshBin: string
}

let sdkTarget: PluginTarget | null = null

/** 由 configureDshRuntime 注入。没注入时教师对话不尝试安装（单测走这条）。 */
export function setEaaToolsPluginTarget(target: PluginTarget | null): void {
  sdkTarget = target
}

/** toolsDir 指向 eaa-tools 时，同级目录里的教育 bundle 一起装。 */
export function resolveEaaPluginDirs(toolsDir: string): string[] {
  const root = dirname(toolsDir)
  const names = [...EAA_PLUGINS.map((plugin) => plugin.dirName), ...EAA_LINK_ONLY_BUNDLES]
  const found: string[] = []
  for (const dirName of names) {
    const dir = join(root, dirName)
    if (existsSync(join(dir, 'package.json'))) found.push(dir)
  }
  return found
}

export async function ensureProfileHasEaaTools(opts: {
  home: string
  profile: string
  toolsDir: string
  dshBin: string
  execPath: string
  electronAsNode: boolean
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const dirs = resolveEaaPluginDirs(opts.toolsDir)
  if (dirs.length === 0) throw new Error(`找不到教育工具插件：${opts.toolsDir}`)
  mkdirSync(opts.home, { recursive: true })
  const plugins = dirs.map((dir) => ({ dir }))
  const pending = dirs.map((dir) => stampInfo(opts.home, opts.profile, dir))
  const stampsOk = pending.every(
    (row) =>
      stampMatches(row.stampPath, row.stamp) ||
      (row.legacyPath && stampMatches(row.legacyPath, row.stamp)),
  )
  if (stampsOk && profileLinksCurrent({ home: opts.home, profile: opts.profile, plugins })) {
    for (const row of pending) {
      if (!stampMatches(row.stampPath, row.stamp))
        writeFileSync(row.stampPath, `${row.stamp}\n`, 'utf8')
    }
    return
  }
  materializeProfileLinks({ home: opts.home, profile: opts.profile, plugins })
  for (const row of pending) writeFileSync(row.stampPath, `${row.stamp}\n`, 'utf8')
}

function stampInfo(
  home: string,
  profile: string,
  dir: string,
): { stamp: string; stampPath: string; legacyPath: string } {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
  }
  const dirName = dir.split(/[\\/]/).pop() ?? 'plugin'
  const stamp = `${pkg.name ?? dirName}@${pkg.version ?? '0'}`
  const stampPath = join(home, `eaa-plugin.${profile}.${dirName}.stamp`)
  const legacyPath = dirName === 'eaa-tools' ? join(home, `eaa-tools.${profile}.stamp`) : ''
  return { stamp, stampPath, legacyPath }
}

function stampMatches(path: string, stamp: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8').trim() === stamp
}

/** 教师对话用的 sdk profile。路径还没注入时直接返回。 */
export async function ensureEaaToolsOnSdkProfile(): Promise<void> {
  const target = sdkTarget
  if (!target) return
  await ensureProfileHasEaaTools({
    ...target,
    profile: 'sdk',
    execPath: process.execPath,
    electronAsNode: false,
  })
}
