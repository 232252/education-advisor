import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const electron = join(import.meta.dirname, '../../node_modules/electron/dist/electron')

describe('Electron cannot host dsh 0.2.2-rc.1', () => {
  it('requireBuiltin 拒绝 Electron 45 的指纹，stock node 可以', () => {
    if (!existsSync(electron)) return
    const script = `
      const addon = require('node-addon-require-builtin')
      try {
        addon.requireBuiltin('internal/modules/esm/loader')
        console.log('REQUIRE_OK')
      } catch (err) {
        console.log('REQUIRE_ERR', err && err.message ? err.message : err)
      }
    `
    const underElectron = spawnSync(electron, ['-e', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    })
    expect(underElectron.stdout).toContain('unsupported Electron runtime fingerprint')
    expect(underElectron.stdout).not.toContain('REQUIRE_OK')

    const underNode = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    expect(underNode.stdout).toContain('REQUIRE_OK')
  })
})
