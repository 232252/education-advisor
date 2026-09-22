import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type { ExposedTool } from '../eaa-mcp-server'
import {
  buildEaaMcpPatch,
  eaaMcpPatchFileName,
  ensureActiveEaaToolBridge,
  mcpPublicName,
  mountEaaAgentTools,
  stopActiveEaaToolBridge,
} from '../tool-bridge'

interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  insert?: {
    id: string
    name: string
    config: {
      serverName: string
      transport: string
      url: string
      headers: Record<string, string>
      toolCallTimeoutMs: number
      failOnStartupError: boolean
    }
  }[]
}

/** parse() 返回 unknown；按 dsh 的 patch 行结构收窄，避免测试里散落 any */
function patchRows(yamlText: string): PatchRow[] {
  return parse(yamlText) as PatchRow[]
}

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

describe('buildEaaMcpPatch', () => {
  it('一行 insert，字段与 mcp-client 的 Config 校验一致', () => {
    const rows = patchRows(
      buildEaaMcpPatch({
        serverName: 'main-1',
        url: 'http://127.0.0.1:9/mcp/main-1',
        token: 't1',
      }),
    )
    const inserted = rows.flatMap((r) => r.insert ?? [])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toEqual({
      id: 'eaa-mcp-main-1',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'main-1',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:9/mcp/main-1',
        headers: { authorization: 'Bearer t1' },
        toolCallTimeoutMs: 120000,
        failOnStartupError: true,
      },
    })
  })

  it('instanceId 与超时可逐项覆盖；token 含特殊字符也由序列化器负责', () => {
    const rows = patchRows(
      buildEaaMcpPatch({
        serverName: 'eaa_tools-1',
        url: 'http://h/mcp/x',
        token: 'x:y z',
        instanceId: 'custom-id',
        toolCallTimeoutMs: 5000,
      }),
    )
    const inserted = rows.flatMap((r) => r.insert ?? [])
    expect(inserted[0].id).toBe('custom-id')
    expect(inserted[0].config.toolCallTimeoutMs).toBe(5000)
    expect(inserted[0].config.serverName).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(inserted[0].config.headers.authorization).toBe('Bearer x:y z')
  })
})

describe('mcp 工具名改写', () => {
  it('dsh 侧强制 mcp__<serverName>__<rawName> 前缀', () => {
    expect(mcpPublicName('class_list', 'main-1')).toBe('mcp__main-1__class_list')
    expect(eaaMcpPatchFileName('main-1')).toBe('eaa-mcp-main-1.cordis.patch.yml')
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

  it('端点只暴露本角色的工具，patch 只描述这个端点', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const mount = await mountEaaAgentTools({
      label: 'psychology',
      tools: [tool('query_score'), tool('history')],
    })
    expect(mount.serverName).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(mount.patchPath).toBe(join(dir, `eaa-mcp-${mount.serverName}.cordis.patch.yml`))
    expect(mount.toolNameMap).toEqual({
      query_score: `mcp__${mount.serverName}__query_score`,
      history: `mcp__${mount.serverName}__history`,
    })

    const rows = patchRows(await readFile(mount.patchPath, 'utf8'))
    const inserted = rows.flatMap((r) => r.insert ?? [])
    expect(inserted).toHaveLength(1)
    expect(inserted[0].config.url).toBe(mount.endpoint.url)
    expect(inserted[0].config.headers.authorization).toBe(`Bearer ${mount.endpoint.token}`)

    expect(await listedTools(mount.endpoint.url, mount.endpoint.token)).toEqual([
      'query_score',
      'history',
    ])

    await mount.release()
    expect(existsSync(mount.patchPath)).toBe(false)
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
    expect(reader.serverName).not.toBe(writer.serverName)

    expect(await listedTools(reader.endpoint.url, reader.endpoint.token)).toEqual(['list_students'])
    expect(await listedTools(writer.endpoint.url, writer.endpoint.token)).toEqual([
      'delete_student',
    ])
    // 只读那份 patch 里没有写工具的挂载行
    const readerRows = patchRows(await readFile(reader.patchPath, 'utf8'))
    expect(readerRows.flatMap((r) => r.insert ?? []).map((i) => i.config.serverName)).toEqual([
      reader.serverName,
    ])
  })

  it('serverName 由 label 净化而来、带序号且不超长', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const first = await mountEaaAgentTools({ label: '学业分析 2024', tools: [tool('a')] })
    const second = await mountEaaAgentTools({ label: '学业分析 2024', tools: [tool('a')] })
    // 非 [A-Za-z0-9_-] 字符换成下划线后剥掉边界下划线，序号保证同角色多次运行不撞名
    expect(first.serverName).toMatch(/^2024-\d+$/)
    expect(second.serverName).toMatch(/^2024-\d+$/)
    expect(second.serverName).not.toBe(first.serverName)
    await expect(
      mountEaaAgentTools({ label: `${'x'.repeat(80)}`, tools: [tool('a')] }),
    ).resolves.toMatchObject({ serverName: expect.stringMatching(/^[A-Za-z0-9_-]{1,32}$/) })
  })

  it('起桥时清扫上次崩溃残留的 patch 文件', async () => {
    await writeFile(join(dir, 'eaa-mcp-main-9.cordis.patch.yml'), 'stale: true\n', 'utf8')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await ensureActiveEaaToolBridge({ patchDir: dir })
    expect(existsSync(join(dir, 'eaa-mcp-main-9.cordis.patch.yml'))).toBe(false)
    expect(existsSync(join(dir, 'sub'))).toBe(true)
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
