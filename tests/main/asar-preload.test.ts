import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { packAsar } from '../../scripts/lib/pack-asar.mjs'

const REGISTER = join(import.meta.dirname, '../../scripts/asar-preload/asar-node-register.mjs')

describe('asar preload', () => {
  it('runs an ESM package, a CJS require, and node_modules.asar from one archive each', () => {
    const root = mkdtempSync(join(tmpdir(), 'asar-preload-'))
    const app = join(root, 'app')
    mkdirSync(join(app, 'node_modules', '@scope', 'boot', 'src'), { recursive: true })
    writeFileSync(join(app, 'package.json'), JSON.stringify({ type: 'module', name: 'app' }))
    writeFileSync(join(app, 'data.txt'), 'hello-from-asar')
    writeFileSync(join(app, 'cjs.cjs'), 'exports.ok = "cjs-ok"\n')
    writeFileSync(
      join(app, 'node_modules', '@scope', 'boot', 'package.json'),
      JSON.stringify({
        type: 'module',
        exports: {
          '.': { types: './missing.d.ts', default: './index.js' },
          './src/*': './src/*',
        },
      }),
    )
    writeFileSync(join(app, 'node_modules', '@scope', 'boot', 'index.js'), 'export const boot = "boot-ok"\n')
    writeFileSync(
      join(app, 'node_modules', '@scope', 'boot', 'src', 'extra.js'),
      'export const extra = "extra-ok"\n',
    )
    writeFileSync(
      join(app, 'index.js'),
      [
        'import { createRequire } from "node:module"',
        'import { readFileSync } from "node:fs"',
        'import { boot } from "@scope/boot"',
        'import { extra } from "@scope/boot/src/extra.js"',
        'const require = createRequire(import.meta.url)',
        'console.log([readFileSync(new URL("./data.txt", import.meta.url), "utf8").trim(), boot, extra, require("./cjs.cjs").ok, String(import.meta.main)].join(" "))',
      ].join('\n'),
    )
    const archive = join(root, 'app.asar')
    packAsar(app, archive)

    const nm = join(root, 'plugin')
    mkdirSync(join(nm, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(nm, 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep', main: 'index.js' }))
    writeFileSync(join(nm, 'node_modules', 'dep', 'index.js'), 'module.exports = "from-nm-asar"\n')
    packAsar(join(nm, 'node_modules'), join(nm, 'node_modules.asar'))
    writeFileSync(join(nm, 'main.mjs'), 'import dep from "dep"\nconsole.log(dep)\n')

    const run = (entry: string) =>
      spawnSync(process.execPath, ['--disable-warning=DEP0180', '--import', REGISTER, entry], {
        encoding: 'utf8',
      })

    const esm = run(join(archive, 'index.js'))
    expect(esm.status, esm.stderr).toBe(0)
    expect(esm.stdout.trim()).toBe('hello-from-asar boot-ok extra-ok cjs-ok true')

    const packedDeps = run(join(nm, 'main.mjs'))
    expect(packedDeps.status, packedDeps.stderr).toBe(0)
    expect(packedDeps.stdout.trim()).toBe('from-nm-asar')
  })
})
