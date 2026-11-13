// =============================================================
// pnpm-env — dsh 子进程环境单元测试
// 真实目录布局（tmpdir 假树）验证：PATH 前置与
// DSH_HOME / ELECTRON_RUN_AS_NODE / NODE_PATH 注入。
// 教师包不含 pnpm（DSH_CORE_RUNTIME.md §3.4），相关解析/垫片已删除。
// =============================================================

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshChildEnv, prependPath } from '../pnpm-env'

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

  it('即使旁边有 @pnpm/exe 或 pnpm.mjs，也不放进 PATH、不生成垫片', () => {
    const withExe = makeTree(true, true)
    const home = join(withExe.root, 'home')
    const env = dshChildEnv({
      home,
      dshBin: withExe.dshBin,
      execPath: 'node',
      electronAsNode: false,
      env: { PATH: 'orig' },
    })
    expect(env.PATH).toBe('orig')
    expect(existsSync(join(home, 'bin'))).toBe(false)

    const scriptOnly = makeTree(false, true)
    const scriptHome = join(scriptOnly.root, 'home')
    const scriptEnv = dshChildEnv({
      home: scriptHome,
      dshBin: scriptOnly.dshBin,
      execPath: 'C:/node/node.exe',
      electronAsNode: false,
      env: { PATH: 'orig' },
    })
    const shimName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    expect(existsSync(join(scriptHome, 'bin', shimName))).toBe(false)
    expect(scriptEnv.PATH).toBe('orig')
  })

  it('开发态仓库 .bin 仍前置，但不带 @pnpm/exe', () => {
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
    expect(env.PATH?.startsWith(`${binDir}${delimiter}`)).toBe(true)
    expect(env.PATH?.includes(exeDir)).toBe(false)
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
