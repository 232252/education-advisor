import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ExposedTool } from '../eaa-mcp-server'
import {
  ensureActiveEaaToolBridge,
  mcpPublicName,
  mountEaaAgentTools,
  pluginProcessEnv,
  stopActiveEaaToolBridge,
} from '../tool-bridge'

function tool(name: string): ExposedTool {
  return {
    name,
    description: `工具 ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: `${name}:done` }] }),
  }
}

async function listedTools(url: string, token: string): Promise<string[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  const body = (await res.json()) as { result?: { tools?: { name: string }[] } }
  return (body.result?.tools ?? []).map((t) => t.name)
}

describe('mcp 工具名改写', () => {
  it('dsh 侧强制 mcp__<serverName>__<rawName> 前缀', () => {
    expect(mcpPublicName('class_list', 'main-1')).toBe('mcp__main-1__class_list')
  })
})

describe('按运行挂载（一次 agent 运行一个端点）', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-mount-'))
  })

  afterEach(async () => {
    await stopActiveEaaToolBridge()
    await rm(dir, { recursive: true, force: true })
  })

  it('未起桥时挂载直接失败（不能悄悄裸跑）', async () => {
    await expect(mountEaaAgentTools({ label: 'main', tools: [tool('a')] })).rejects.toThrow(
      /工具桥未启动/,
    )
  })

  it('端点只暴露本角色的工具，名字走已安装插件', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const mount = await mountEaaAgentTools({
      label: 'psychology',
      tools: [tool('query_score'), tool('history')],
    })
    expect(mount).not.toHaveProperty('patchPath')
    expect(mount.serverName).toBe('eaa')
    expect(mount.toolNameMap).toEqual({
      query_score: 'mcp__eaa__query_score',
      history: 'mcp__eaa__history',
    })
    expect(await listedTools(mount.endpoint.url, mount.endpoint.token)).toEqual([
      'query_score',
      'history',
    ])

    await mount.release()
    const after = await fetch(mount.endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${mount.endpoint.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(after.status).toBe(404)
  })

  it('并发两次运行互不可见（后挂的拿不到先挂的工具）', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const reader = await mountEaaAgentTools({ label: 'main', tools: [tool('list_students')] })
    const writer = await mountEaaAgentTools({ label: 'main', tools: [tool('delete_student')] })
    expect(reader.endpoint.url).not.toBe(writer.endpoint.url)

    expect(await listedTools(reader.endpoint.url, reader.endpoint.token)).toEqual(['list_students'])
    expect(await listedTools(writer.endpoint.url, writer.endpoint.token)).toEqual([
      'delete_student',
    ])
  })

  it('两次挂载用不同端点，公开名仍是插件名', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const first = await mountEaaAgentTools({ label: '学业分析 2024', tools: [tool('a')] })
    const second = await mountEaaAgentTools({ label: '学业分析 2024', tools: [tool('a')] })
    expect(first.serverName).toBe('eaa')
    expect(second.serverName).toBe('eaa')
    expect(first.endpoint.url).not.toBe(second.endpoint.url)
    expect(first.toolNameMap.a).toBe('mcp__eaa__a')
  })

  it('起桥时清扫上次崩溃残留的 patch 文件', async () => {
    await writeFile(join(dir, 'eaa-mcp-main-9.cordis.patch.yml'), 'stale: true\n', 'utf8')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await ensureActiveEaaToolBridge({ patchDir: dir })
    expect(existsSync(join(dir, 'eaa-mcp-main-9.cordis.patch.yml'))).toBe(false)
    expect(existsSync(join(dir, 'sub'))).toBe(true)
  })

  it('plugin 模式按插件拆端点，没有的组不给地址', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const mount = await mountEaaAgentTools({
      label: 'main',
      tools: [
        tool('eaa_score'),
        tool('eaa_list_students'),
        tool('eaa_import_grades'),
        tool('eaa_grading_publish'),
      ],
    })
    expect(mount).not.toHaveProperty('patchPath')
    expect(mount.toolNameMap).toEqual({
      eaa_score: 'mcp__eaa__eaa_score',
      eaa_list_students: 'mcp__roster__eaa_list_students',
      eaa_import_grades: 'mcp__grades__eaa_import_grades',
      eaa_grading_publish: 'mcp__grading__eaa_grading_publish',
    })
    const env = pluginProcessEnv(mount.pluginEndpoints)
    expect(Object.keys(env).sort()).toEqual([
      'EAA_GRADES_MCP_TOKEN',
      'EAA_GRADES_MCP_URL',
      'EAA_GRADING_MCP_TOKEN',
      'EAA_GRADING_MCP_URL',
      'EAA_MCP_TOKEN',
      'EAA_MCP_URL',
      'EAA_ROSTER_MCP_TOKEN',
      'EAA_ROSTER_MCP_URL',
    ])
    const byName = Object.fromEntries(mount.pluginEndpoints.map((ep) => [ep.serverName, ep]))
    expect(await listedTools(byName.roster.url, byName.roster.token)).toEqual(['eaa_list_students'])
    expect(await listedTools(byName.grades.url, byName.grades.token)).toEqual(['eaa_import_grades'])
    expect(await listedTools(byName.grading.url, byName.grading.token)).toEqual([
      'eaa_grading_publish',
    ])
    expect(await listedTools(byName.eaa.url, byName.eaa.token)).toEqual(['eaa_score'])

    const rosterOnly = await mountEaaAgentTools({
      label: 'main',
      tools: [tool('eaa_create_class')],
    })
    expect(pluginProcessEnv(rosterOnly.pluginEndpoints)).not.toHaveProperty('EAA_MCP_URL')
    expect(rosterOnly.toolNameMap.eaa_create_class).toBe('mcp__roster__eaa_create_class')
    await mount.release()
    const gone = await fetch(byName.roster.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${byName.roster.token}`,
      },
      body: '{}',
    })
    expect(gone.status).toBe(404)
  })

  it('幂等：重复 ensure 复用同一监听，stop 后端口关闭', async () => {
    const a = await ensureActiveEaaToolBridge({ patchDir: dir })
    const b = await ensureActiveEaaToolBridge({ patchDir: dir })
    expect(b.port).toBe(a.port)

    const url = `http://127.0.0.1:${a.port}/mcp/none`
    await expect(fetch(url, { method: 'POST', body: '{}' })).resolves.toBeTruthy()
    await stopActiveEaaToolBridge()
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow()
    await expect(mountEaaAgentTools({ label: 'main', tools: [] })).rejects.toThrow(/工具桥未启动/)
  })
})
