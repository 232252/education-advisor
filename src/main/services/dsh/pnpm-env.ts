// =============================================================
// dsh 子进程的环境与随包 pnpm 工具链
//
// `dsh plugin --profile ... add` 在 dsh 内部用 execa("pnpm") 装插件，只认
// PATH。开发态仓库 node_modules/.bin 里有 pnpm.cmd；打包态 electron-builder
// 会剥掉 .bin（app-builder-lib 的 NodeModuleCopyHelper 把它列进排除表），
// 教师机器上又没有全局 pnpm —— 安装版连接中心首装因此必败：
//   'pnpm' 不是内部或外部命令 … 退出码 1
//
// Windows 上 execa("pnpm") 走 CreateProcess，libuv 只按 PATH 解析真 exe，
// .cmd 垫片对它不可见（Node 18.20+ 还会直接 EINVAL）；pnpm 12 的
// bin/pnpm.mjs 又只是引导壳（真 CLI 只有 @pnpm/exe 的原生二进制，引导壳
// 缺它就转联网自下载）—— 所以 @pnpm/exe.<platform>-<arch> 必须随包，把
// 它的目录前置进 PATH。垫片只在 exe 缺席（optional 依赖没装上）时兜底：
// posix 上 execve 认 shebang，.sh 可用；Windows 的 .cmd 只服务我们自己
// spawn 的场景。
// =============================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 随包 @pnpm/exe 的 pnpm 可执行文件；不在时返回 null。 */
export function packagedPnpmExePath(
  dshBin: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (!dshBin) return null
  const exe = platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const packed = join(dirname(dshBin), '..', '..', '..', '@pnpm', `exe.${platform}-${arch}`, exe)
  // dsh 入口在 app.asar 里时，算出的路径也在归档内。操作系统只能执行解出来的那份。
  const unpacked = packed.replace(/\.asar([\\/])/, '.asar.unpacked$1')
  if (unpacked !== packed && existsSync(unpacked)) return unpacked
  return existsSync(packed) ? packed : null
}

/** dsh 旁边 node_modules/pnpm 的 bin/pnpm.mjs（垫片兜底的原料）。 */
export function packagedPnpmScript(dshBin: string): string | null {
  if (!dshBin) return null
  const script = join(dirname(dshBin), '..', '..', '..', 'pnpm', 'bin', 'pnpm.mjs')
  return existsSync(script) ? script : null
}

/**
 * 在 <home>/bin 生成 pnpm 垫片，返回目录；写不进去就返回 null。
 * execPath 可能是 Electron 可执行文件（找不到独立 node 时的兜底），
 * 垫片里带上 ELECTRON_RUN_AS_NODE=1 —— 对纯 node 无影响。
 */
export function ensurePnpmShimDir(home: string, execPath: string, script: string): string | null {
  const dir = join(home, 'bin')
  try {
    mkdirSync(dir, { recursive: true })
    const launch = nodeLaunch(execPath, script)
    if (process.platform === 'win32') {
      writeFileSync(
        join(dir, 'pnpm.cmd'),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${launch} %*\r\n`,
        'utf8',
      )
    } else {
      writeFileSync(
        join(dir, 'pnpm'),
        `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${launch} "$@"\n`,
        { mode: 0o755 },
      )
    }
    return dir
  } catch {
    return null
  }
}

function nodeLaunch(execPath: string, script: string): string {
  const register = process.env.EAA_ASAR_REGISTER
  if (register && script.includes('.asar')) {
    const url = pathToFileURL(register).href
    return `"${execPath}" --disable-warning=DEP0180 --import "${url}" "${script}"`
  }
  return `"${execPath}" "${script}"`
}

/** 目录前置进 PATH（Windows 的 env 大小写两种键名都写）。 */
export function prependPath(env: NodeJS.ProcessEnv, dir: string): void {
  const current = env.PATH ?? env.Path ?? ''
  const next = current ? `${dir}${delimiter}${current}` : dir
  env.PATH = next
  env.Path = next
}

export interface DshChildEnvOptions {
  home: string
  dshBin: string
  execPath: string
  electronAsNode: boolean
  env?: NodeJS.ProcessEnv
  /**
   * 按需组件目录（office-kit-service 的 extraModulesDir）—— 追加进
   * NODE_PATH，让 dsh web 子进程也能解析被移出安装包的 libreoffice-kit。
   */
  extraModulesDir?: string
}

/**
 * dsh 子进程（plugin add / web）的公共环境：DSH_HOME、ELECTRON_RUN_AS_NODE、
 * 把随包 pnpm 前置进 PATH。前置顺序从左到右是 @pnpm/exe → 仓库 .bin →
 * 垫片目录 → 原 PATH：打包态只有 @pnpm/exe 的真二进制能被 dsh 内部的
 * execa("pnpm") 命中；开发态 .bin 与 exe 同版本，先后无妨。垫片只在
 * exe 缺席时生成（posix 可用，Windows 上只服务我们自己的 spawn）。
 */
export function dshChildEnv(opts: DshChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), DSH_HOME: opts.home }
  if (opts.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  if (opts.extraModulesDir) {
    env.NODE_PATH = env.NODE_PATH
      ? `${env.NODE_PATH}${delimiter}${opts.extraModulesDir}`
      : opts.extraModulesDir
  }
  const binDir = join(dirname(opts.dshBin || ''), '..', '..', '..', '.bin')
  if (opts.dshBin && existsSync(binDir)) prependPath(env, binDir)
  const exePath = packagedPnpmExePath(opts.dshBin)
  if (exePath) {
    prependPath(env, dirname(exePath))
  } else {
    const script = packagedPnpmScript(opts.dshBin)
    if (script) {
      const shimDir = ensurePnpmShimDir(opts.home, opts.execPath, script)
      if (shimDir) prependPath(env, shimDir)
    }
  }
  return env
}
