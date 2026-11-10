// =============================================================
// dsh 0.2.1 的 node-addon-require-builtin 只认几份精确的 Electron 指纹
// （43.0.0 / 44.0.0 / 44.7.0）。本应用是 Electron 43.2.0，用它自己的 exe
// 加 ELECTRON_RUN_AS_NODE 去跑 dsh，子进程会直接退出，对话拿到空回复。
// 机器上有独立的 node 时改用那一份。
// =============================================================

import { execFileSync, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

let cachedNode: string | null = null
let hooked = false
let configuredNode: string | undefined
let asarRegister: string | undefined

/** 打包态 resources/asar-preload 的入口。开发态不设置，子进程直接读真实文件。 */
export function configureDshAsarRegister(registerPath: string | undefined): void {
  asarRegister = registerPath && existsSync(registerPath) ? registerPath : undefined
}

type SpawnLike = (
  command: string,
  args?: readonly string[] | SpawnOptions,
  options?: SpawnOptions,
) => unknown

/** Array.isArray 的类型谓词是 any[]，消不掉 readonly string[]，假分支会把参数表留在选项上。 */
function isArgList(
  value: readonly string[] | SpawnOptions | undefined,
): value is readonly string[] {
  return Array.isArray(value)
}

function isDshLaunchArg(arg: string): boolean {
  const normalized = arg.replaceAll('\\', '/')
  return normalized.includes('/@deepseek-ai/dsh/') || normalized.endsWith('/dsh/lib/bin.js')
}

export function rewriteDshCommand(
  command: string,
  args: readonly string[] | undefined | object,
  electronPath: string,
  systemNode: string | undefined,
): { command: string; dropElectronRunAsNode: boolean } {
  const argv = Array.isArray(args) ? args : []
  const launchesDsh = argv.some((arg) => isDshLaunchArg(arg))
  if (!systemNode || command !== electronPath || !launchesDsh) {
    return { command, dropElectronRunAsNode: false }
  }
  return { command: systemNode, dropElectronRunAsNode: true }
}

/** 打包态或开发态事先放好的 node。必须在第一次拉起 dsh 之前调用。 */
export function configureDshNode(nodePath: string | undefined): void {
  configuredNode = nodePath && existsSync(nodePath) ? nodePath : undefined
  cachedNode = null
}

/**
 * 替换 child_process.spawn。必须调用替换前保存的原函数：
 * 替换之后再读 `child_process.spawn` 会读到自己，子进程根本起不来。
 */
export function createDshSpawnPatch(
  originalSpawn: SpawnLike,
  electronPath: string,
  systemNode: string,
): SpawnLike {
  return (command, args, options) => {
    const argv = isArgList(args) ? args : undefined
    const spawnOptions = isArgList(args) ? options : args
    const rewritten = rewriteDshCommand(command, argv, electronPath, systemNode)
    let next = rewritten.dropElectronRunAsNode
      ? stripElectronRunAsNode(spawnOptions)
      : spawnOptions
    let launchArgs = argv
    if (rewritten.dropElectronRunAsNode && asarRegister) {
      const injected = injectAsarHook(launchArgs, next)
      launchArgs = injected.args
      next = injected.options
    }
    return launchArgs
      ? originalSpawn(rewritten.command, launchArgs, next)
      : originalSpawn(rewritten.command, next)
  }
}

export function resolveSystemNode(): string | undefined {
  if (cachedNode !== null) return cachedNode || undefined
  if (typeof process.versions.electron !== 'string') {
    cachedNode = ''
    return undefined
  }
  const fromEnv = process.env.EAA_NODE
  if (fromEnv && existsSync(fromEnv)) {
    cachedNode = fromEnv
    return fromEnv
  }
  if (configuredNode) {
    cachedNode = configuredNode
    return configuredNode
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const listed = execFileSync(finder, ['node'], { encoding: 'utf8', windowsHide: true })
    const hit = listed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && existsSync(line) && !line.toLowerCase().includes('electron'))
    cachedNode = hit ?? ''
    return hit
  } catch {
    cachedNode = ''
    return undefined
  }
}

/** SDK 写死用 process.execPath 起 dsh。在第一次 import SDK 之前换成系统 node。 */
export function installDshNodeSpawnHook(): void {
  if (hooked) return
  const systemNode = resolveSystemNode()
  if (!systemNode) return
  hooked = true
  const electronPath = process.execPath
  const childProcess = require('node:child_process') as typeof import('node:child_process')
  const originalSpawn = childProcess.spawn.bind(childProcess) as SpawnLike
  childProcess.spawn = createDshSpawnPatch(
    originalSpawn,
    electronPath,
    systemNode,
  ) as typeof childProcess.spawn
}

function injectAsarHook(
  argv: readonly string[] | undefined,
  options: SpawnOptions | undefined,
): { args: readonly string[] | undefined; options: SpawnOptions | undefined } {
  if (!asarRegister) return { args: argv, options }
  const url = pathToFileURL(asarRegister).href
  const args = argv ? ['--disable-warning=DEP0180', '--import', url, ...argv] : argv
  const env = { ...(options?.env ?? process.env) }
  const flag = `--import=${url}`
  if (!env.NODE_OPTIONS?.includes(url)) {
    env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${flag}` : flag
  }
  return { args, options: { ...options, env } }
}

function stripElectronRunAsNode(options: SpawnOptions | undefined): SpawnOptions {
  const env = { ...(options?.env ?? process.env) }
  delete env.ELECTRON_RUN_AS_NODE
  return { ...options, env }
}
