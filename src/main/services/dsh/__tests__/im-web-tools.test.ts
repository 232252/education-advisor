import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startEaaMcpServer } from '../eaa-mcp-server'
import { EAA_MCP_TOKEN_ENV, EAA_MCP_URL_ENV, EAA_PLUGINS } from '../eaa-tools-contract'
import { ensureEaaHardeningPatch } from '../hardening'
import { ensureEaaImPresetPatch, ensureOfficialPresetLock } from '../im-preset'
import { dshWebLaunchArgs, parseDshWebAnnouncement } from '../im-url'
import { ensureProfileHasEaaTools } from '../plugin-install'

const DSH_BIN = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const TOOLS_DIR = join(process.cwd(), 'vendor', 'eaa-tools')

function bootWeb(
  home: string,
  patches: string[],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const child = spawn(process.execPath, [DSH_BIN, ...dshWebLaunchArgs(patches)], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, ...extraEnv },
    windowsHide: true,
  })
  let buffer = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    buffer += chunk
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      finish(null, `dsh web 没有在时限内打印地址:\n${buffer.slice(-2000)}`)
    }, 90_000)
    const finish = (url: string | null, failed: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      if (url) resolve(url)
      else reject(new Error(failed ?? buffer.slice(-2000)))
    }
    const tick = () => {
      const found = parseDshWebAnnouncement(buffer)
      if (found) {
        if (buffer.includes('initial connection or tool synchronization failed')) {
          finish(null, buffer.slice(-2000))
          return
        }
        finish(found, null)
        return
      }
      if (child.exitCode !== null)
        finish(null, `dsh web 提前退出 code=${child.exitCode}\n${buffer.slice(-2000)}`)
    }
    child.stdout?.on('data', tick)
    child.stderr?.on('data', tick)
    child.once('exit', tick)
  })
}

describe('eaa-tools 插件', () => {
  it('每个插件的补丁约定自己的环境变量和 serverName', () => {
    for (const plugin of EAA_PLUGINS) {
      const text = readFileSync(
        join(process.cwd(), 'vendor', plugin.dirName, 'cordis.patch.yml'),
        'utf8',
      )
      expect(text).toContain(`serverName: ${plugin.serverName}`)
      expect(text).toContain(plugin.urlEnv)
      expect(text).toContain(plugin.tokenEnv)
    }
    expect(EAA_MCP_URL_ENV).toBe('EAA_MCP_URL')
    expect(EAA_MCP_TOKEN_ENV).toBe('EAA_MCP_TOKEN')
  })

  it('装进 web profile 后能连上教育工具，没有地址时也不会把启动拖死', async () => {
    const home = mkdtempSync(join(tmpdir(), 'eaa-dsh-plugin-'))
    const patchDir = join(home, 'patches')
    mkdirSync(patchDir, { recursive: true })
    const hardening = ensureEaaHardeningPatch(patchDir)
    const skillDir = join(home, 'skills')
    mkdirSync(skillDir, { recursive: true })
    const preset = ensureEaaImPresetPatch(patchDir, skillDir)
    const lock = ensureOfficialPresetLock(patchDir, DSH_BIN, skillDir)
    expect(lock).toBeTruthy()
    const patches = [hardening, preset, lock!]
    await ensureProfileHasEaaTools({
      home,
      profile: 'web',
      toolsDir: TOOLS_DIR,
      dshBin: DSH_BIN,
      execPath: process.execPath,
      electronAsNode: false,
    })

    const withoutTools = await bootWeb(home, patches)
    expect(withoutTools.startsWith('http://127.0.0.1:')).toBe(true)

    const server = await startEaaMcpServer({ port: 0 })
    const env: Record<string, string> = {}
    for (const plugin of EAA_PLUGINS) {
      const endpoint = server.register({
        name: `im-${plugin.serverName}`,
        tools: [
          {
            name: plugin.toolNames[0] ?? 'eaa_score',
            description: plugin.serverName,
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
          },
        ],
      })
      env[plugin.urlEnv] = endpoint.url
      env[plugin.tokenEnv] = endpoint.token
    }
    try {
      const withTools = await bootWeb(home, patches, env)
      expect(withTools.startsWith('http://127.0.0.1:')).toBe(true)
    } finally {
      await server.close()
    }
  }, 180_000)
})
