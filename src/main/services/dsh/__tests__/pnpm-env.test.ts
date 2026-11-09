// =============================================================
// pnpm-env — 随包 pnpm 工具链解析与 dsh 子进程环境单元测试
// 真实目录布局（tmpdir 假树）验证：@pnpm/exe 优先、pnpm.mjs 垫片兜底、
// PATH 前置与 DSH_HOME / ELECTRON_RUN_AS_NODE 注入。
// =============================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dshChildEnv,
  ensurePnpmShimDir,
  packagedPnpmExePath,
  packagedPnpmScript,
  prependPath,
} from '../pnpm-env'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

/**
 * 假一棵打包态目录树：dsh 的 bin.js 旁边按需放 @pnpm/exe 与 pnpm.mjs。
 * exe 目录默认按当前运行平台构造 —— dshChildEnv 等不带平台参数的生产代码
 * 按 process.platform 解析，假树必须与之同平台（CI 的 linux 上也要能命中）。
 */
function makeTree(
  withExe: boolean,
  withScript: boolean,
  exePlatform: NodeJS.Platform = process.platform,
  exeArch: string = process.arch,
): { root: string; dshBin: string; exeDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-env-'))
  dirs.push(root)
  const dshBin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  mkdirSync(dirname(dshBin), { recursive: true })
  writeFileSync(dshBin, '')
  const exeDir = join(root, 'node_modules', '@pnpm', `exe.${exePlatform}-${exeArch}`)
  if (withExe) {
    const exe = join(exeDir, exePlatform === 'win32' ? 'pnpm.exe' : 'pnpm')
    mkdirSync(dirname(exe), { recursive: true })
    writeFileSync(exe, '')
  }
  if (withScript) {
    const script = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, '')
  }
  return { root, dshBin, exeDir }
}

describe('packagedPnpmExePath', () => {
  it('win32-x64 树里找到 @pnpm/exe 的 pnpm.exe', () => {
    const { root, dshBin } = makeTree(true, false, 'win32', 'x64')
    expect(packagedPnpmExePath(dshBin, 'win32', 'x64')).toBe(
      join(root, 'node_modules', '@pnpm', 'exe.win32-x64', 'pnpm.exe'),
    )
  })

  it('darwin 按平台包名找无扩展名的 pnpm', () => {
    const { root, dshBin } = makeTree(false, false)
    const exe = join(root, 'node_modules', '@pnpm', 'exe.darwin-arm64', 'pnpm')
    mkdirSync(dirname(exe), { recursive: true })
    writeFileSync(exe, '')
    expect(packagedPnpmExePath(dshBin, 'darwin', 'arm64')).toBe(exe)
  })

  it('没有 @pnpm/exe 或 dshBin 为空时返回 null', () => {
    const { dshBin } = makeTree(false, false)
    expect(packagedPnpmExePath(dshBin)).toBeNull()
    expect(packagedPnpmExePath('')).toBeNull()
  })
})

describe('packagedPnpmScript', () => {
  it('找到 dsh 旁边的 pnpm.mjs；没有时返回 null', () => {
    const { root, dshBin } = makeTree(false, true)
    expect(packagedPnpmScript(dshBin)).toBe(join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))
    const empty = makeTree(false, false)
    expect(packagedPnpmScript(empty.dshBin)).toBeNull()
    expect(packagedPnpmScript('')).toBeNull()
  })
})

describe('ensurePnpmShimDir', () => {
  it('生成 pnpm 垫片：node + pnpm.mjs，并为 Electron 兜底设 ELECTRON_RUN_AS_NODE', () => {
    const { root } = makeTree(false, true)
    const home = join(root, 'home')
    const script = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    const dir = ensurePnpmShimDir(home, 'C:/node/node.exe', script)
    expect(dir).toBe(join(home, 'bin'))
    if (!dir) throw new Error('垫片目录应生成成功')
    // 垫片名随平台：win 是 pnpm.cmd，posix 是带 shebang 的 pnpm
    const shimName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const cmd = readFileSync(join(dir, shimName), 'utf8')
    expect(cmd).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(cmd).toContain('C:/node/node.exe')
    expect(cmd).toContain(script)
  })
})

describe('prependPath', () => {
  it('目录放最前，PATH 与 Path 双键都写', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'orig' }
    prependPath(env, 'C:/extra')
    expect(env.PATH).toBe(`C:/extra${delimiter}orig`)
    expect(env.Path).toBe(env.PATH)
  })
})

describe('dshChildEnv', () => {
  it('注入 DSH_HOME 与 ELECTRON_RUN_AS_NODE，原 env 透传', () => {
    const { dshBin } = makeTree(false, false)
    const env = dshChildEnv({
      home: 'C:/home',
      dshBin,
      execPath: 'node',
      electronAsNode: true,
      env: { MODEL_KEY: 'k', PATH: 'orig' },
    })
    expect(env.DSH_HOME).toBe('C:/home')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.MODEL_KEY).toBe('k')
  })

  it('有 @pnpm/exe 时把其目录前置进 PATH，且不再生成垫片', () => {
    const { root, dshBin, exeDir } = makeTree(true, true)
    const home = join(root, 'home')
    const env = dshChildEnv({
      home,
      dshBin,
      execPath: 'node',
      electronAsNode: false,
      env: { PATH: 'orig' },
    })
    expect(env.PATH?.startsWith(`${exeDir}${delimiter}`)).toBe(true)
    expect(existsSync(join(home, 'bin'))).toBe(false)
  })

  it('没有 @pnpm/exe 时退而在 <home>/bin 生成垫片并前置', () => {
    const { root, dshBin } = makeTree(false, true)
    const home = join(root, 'home')
    const env = dshChildEnv({
      home,
      dshBin,
      execPath: 'C:/node/node.exe',
      electronAsNode: false,
      env: { PATH: 'orig' },
    })
    const shimDir = join(home, 'bin')
    const shimName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    expect(existsSync(join(shimDir, shimName))).toBe(true)
    expect(env.PATH?.startsWith(`${shimDir}${delimiter}`)).toBe(true)
  })

  it('开发态仓库 .bin 也前置（排在随包 exe 之后）', () => {
    const { root, dshBin, exeDir } = makeTree(true, false)
    const binDir = join(root, 'node_modules', '.bin')
    mkdirSync(binDir, { recursive: true })
    const env = dshChildEnv({
      home: join(root, 'home'),
      dshBin,
      execPath: 'node',
      electronAsNode: false,
      env: { PATH: 'orig' },
    })
    expect(env.PATH?.startsWith(`${exeDir}${delimiter}${binDir}${delimiter}`)).toBe(true)
  })

  it('extraModulesDir 追加进 NODE_PATH（已有值时续在后面）', () => {
    const { dshBin } = makeTree(false, false)
    const fresh = dshChildEnv({
      home: 'C:/home',
      dshBin,
      execPath: 'node',
      electronAsNode: false,
      env: { PATH: 'orig' },
      extraModulesDir: 'C:/data/dsh-extra-modules',
    })
    expect(fresh.NODE_PATH).toBe('C:/data/dsh-extra-modules')
    const chained = dshChildEnv({
      home: 'C:/home',
      dshBin,
      execPath: 'node',
      electronAsNode: false,
      env: { PATH: 'orig', NODE_PATH: 'C:/other' },
      extraModulesDir: 'C:/data/dsh-extra-modules',
    })
    expect(chained.NODE_PATH).toBe(`C:/other${delimiter}C:/data/dsh-extra-modules`)
  })
})
