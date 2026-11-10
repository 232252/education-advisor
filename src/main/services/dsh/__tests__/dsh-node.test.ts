import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { configureDshAsarRegister, createDshSpawnPatch, rewriteDshCommand } from '../dsh-node'

const electron = `C:${sep}App${sep}electron.exe`
const node = `C:${sep}node${sep}node.exe`
const dshBin = `C:${sep}app${sep}node_modules${sep}@deepseek-ai${sep}dsh${sep}lib${sep}bin.js`

describe('rewriteDshCommand', () => {
  it('把 Electron 起的 dsh 换成系统 node', () => {
    const result = rewriteDshCommand(electron, [dshBin, '--profile', 'sdk'], electron, node)
    expect(result).toEqual({ command: node, dropElectronRunAsNode: true })
  })

  it('其它子进程保持原命令', () => {
    const result = rewriteDshCommand(electron, ['--version'], electron, node)
    expect(result).toEqual({ command: electron, dropElectronRunAsNode: false })
  })

  it('没有系统 node 时不改', () => {
    const result = rewriteDshCommand(electron, [dshBin], electron, undefined)
    expect(result.command).toBe(electron)
    expect(result.dropElectronRunAsNode).toBe(false)
  })

  it('正斜杠路径也认作 dsh', () => {
    const forward = 'C:/app/node_modules/@deepseek-ai/dsh/lib/bin.js'
    const result = rewriteDshCommand(electron, [forward, '--profile', 'sdk'], electron, node)
    expect(result.command).toBe(node)
  })
})

describe('createDshSpawnPatch', () => {
  it('调用替换前保存的 spawn，并去掉 ELECTRON_RUN_AS_NODE', () => {
    const seen: Array<{ command: string; env?: NodeJS.ProcessEnv }> = []
    const original = (
      command: string,
      _args?: readonly string[] | object,
      options?: { env?: NodeJS.ProcessEnv },
    ) => {
      seen.push({ command, env: options?.env })
      return { pid: 1 }
    }
    const patched = createDshSpawnPatch(original, electron, node)
    patched(electron, [dshBin, '--profile', 'sdk'], {
      env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'x' },
    })
    expect(seen).toEqual([{ command: node, env: { PATH: 'x' } }])
  })

  it('打包态给 stock node 加上 asar 预加载，argv 里的 dsh 参数位置不变', () => {
    const register = joinTmp('asar-node-register.mjs')
    configureDshAsarRegister(register)
    const seen: Array<{ command: string; args?: readonly string[]; env?: NodeJS.ProcessEnv }> = []
    const original = (
      command: string,
      args?: readonly string[] | object,
      options?: { env?: NodeJS.ProcessEnv },
    ) => {
      seen.push({ command, args: Array.isArray(args) ? args : undefined, env: options?.env })
      return { pid: 1 }
    }
    const patched = createDshSpawnPatch(original, electron, node)
    patched(electron, [dshBin, '--profile', 'sdk'], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'x' } })
    const url = pathToFileURL(register).href
    expect(seen[0]?.command).toBe(node)
    expect(seen[0]?.args?.slice(0, 3)).toEqual(['--disable-warning=DEP0180', '--import', url])
    expect(seen[0]?.args?.slice(3)).toEqual([dshBin, '--profile', 'sdk'])
    expect(seen[0]?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(seen[0]?.env?.NODE_OPTIONS).toContain(`--import=${url}`)
    configureDshAsarRegister(undefined)
  })
})

function joinTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-asar-'))
  const file = join(dir, name)
  writeFileSync(file, '')
  return file
}
