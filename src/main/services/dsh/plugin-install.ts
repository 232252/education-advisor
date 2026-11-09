// =============================================================
// 把 vendor/eaa-tools 用 link: 装进某个 profile。
//
// 插件自己不带学生数据。宿主起本机工具端点后，把地址和令牌放进
// 子进程环境；插件没看到地址就保持关闭。
// =============================================================

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveSystemNode } from './dsh-node'
import { EAA_PLUGINS } from './eaa-tools-contract'
import { dshPluginLinkSpec } from './im-url'
import { dshChildEnv } from './pnpm-env'

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

/** toolsDir 指向 eaa-tools 时，同级目录里的花名册、成绩、批改插件一起装。 */
export function resolveEaaPluginDirs(toolsDir: string): string[] {
  const root = dirname(toolsDir)
  const found: string[] = []
  for (const plugin of EAA_PLUGINS) {
    const dir = join(root, plugin.dirName)
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
  for (const dir of dirs) await installLinkedPlugin(opts, dir)
}

async function installLinkedPlugin(
  opts: {
    home: string
    profile: string
    dshBin: string
    execPath: string
    electronAsNode: boolean
    env?: NodeJS.ProcessEnv
  },
  dir: string,
): Promise<void> {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
  }
  const dirName = dir.split(/[\\/]/).pop() ?? 'plugin'
  const stamp = `${pkg.name ?? dirName}@${pkg.version ?? '0'}`
  const stampPath = join(opts.home, `eaa-plugin.${opts.profile}.${dirName}.stamp`)
  const legacyPath =
    dirName === 'eaa-tools' ? join(opts.home, `eaa-tools.${opts.profile}.stamp`) : ''
  if (stampMatches(stampPath, stamp) || (legacyPath && stampMatches(legacyPath, stamp))) {
    if (!stampMatches(stampPath, stamp)) writeFileSync(stampPath, `${stamp}\n`, 'utf8')
    return
  }
  await runDsh(opts, ['plugin', '--profile', opts.profile, 'add', dshPluginLinkSpec(dir)])
  writeFileSync(stampPath, `${stamp}\n`, 'utf8')
}

function stampMatches(path: string, stamp: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8').trim() === stamp
}

/** 教师对话用的 sdk profile。路径还没注入时直接返回。 */
export async function ensureEaaToolsOnSdkProfile(): Promise<void> {
  const target = sdkTarget
  if (!target) return
  const node = resolveSystemNode()
  await ensureProfileHasEaaTools({
    ...target,
    profile: 'sdk',
    execPath: node ?? process.execPath,
    electronAsNode: node === undefined && Boolean(process.versions.electron),
  })
}

function runDsh(
  opts: {
    home: string
    dshBin: string
    execPath: string
    electronAsNode: boolean
    env?: NodeJS.ProcessEnv
  },
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(opts.execPath, [opts.dshBin, ...args], {
      cwd: opts.home,
      env: dshChildEnv(opts),
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(`dsh ${args.join(' ')} 退出码 ${code ?? 'null'}${stderr ? `: ${stderr}` : ''}`),
        )
    })
  })
}
