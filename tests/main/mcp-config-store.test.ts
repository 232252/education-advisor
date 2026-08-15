// =============================================================
// McpConfigStore — 配置加载/合并/新增/持久化测试
// 覆盖: loadConfigFile(ENOENT/过滤/插值/净化)、loadConfig 合并覆盖、
//       addServer 校验链、writeUserConfig 大小上限、serializeWrite 串行
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@shared/types'
import yaml from 'yaml'

const tmpDir = path.join(
  os.tmpdir(),
  `mcp-config-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const globalYaml = path.join(tmpDir, 'global', 'mcp.yaml')

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return path.join(tmpDir, 'userData')
    throw new Error(`Unexpected path: ${name}`)
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    isPackaged: false,
  },
}))

const { McpConfigStore } = await import('../../src/main/services/mcp-config-store')

const userYaml = path.join(tmpDir, 'userData', 'mcp.user.yaml')

function stdioCfg(p: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv1',
    name: 'S1',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'x'],
    ...p,
  }
}

function yamlOf(servers: unknown): string {
  return yaml.stringify({ servers })
}
describe('McpConfigStore', () => {
  let store: InstanceType<typeof McpConfigStore>

  beforeAll(async () => {
    await fsp.mkdir(path.dirname(globalYaml), { recursive: true })
    await fsp.mkdir(path.dirname(userYaml), { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    // 每个用例前重置磁盘与内存状态
    try {
      await fsp.unlink(userYaml)
    } catch {
      /* ignore */
    }
    try {
      await fsp.unlink(globalYaml)
    } catch {
      /* ignore */
    }
    store = new McpConfigStore(globalYaml)
  })

  describe('loadConfigFile', () => {
    it('文件不存在(ENOENT)返回空数组', async () => {
      expect(await store.loadConfigFile(path.join(tmpDir, 'nope.yaml'), 'user')).toEqual([])
    })

    it('无 servers 键返回空数组', async () => {
      await fsp.writeFile(globalYaml, yamlOf(undefined).replace('servers', 'other'), 'utf-8')
      const result = await store.loadConfigFile(globalYaml, 'global')
      expect(result).toEqual([])
    })

    it('非法 YAML 返回空数组', async () => {
      await fsp.writeFile(globalYaml, '{{{{not yaml', 'utf-8')
      const result = await store.loadConfigFile(globalYaml, 'global')
      expect(result).toEqual([])
    })

    it('过滤无效配置项,仅保留有效项并标记 source', async () => {
      await fsp.writeFile(
        globalYaml,
        yamlOf([
          stdioCfg({ id: 'good' }),
          { id: 'bad-transport', name: 'X', enabled: true, transport: 'carrier-pigeon' },
          { name: 'no-id', enabled: true, transport: 'stdio', command: 'x' },
          { id: 'sse-no-url', name: 'X', enabled: true, transport: 'sse' },
        ]),
        'utf-8',
      )
      const result = await store.loadConfigFile(globalYaml, 'global')
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'good', source: 'global' })
    })

    it('深度插值 ${VAR} 与 ${env.VAR}', async () => {
      process.env.MCP_TEST_HOST = 'example.test'
      try {
        await fsp.writeFile(
          globalYaml,
          yamlOf([
            {
              id: 'sse1',
              name: 'SSE',
              enabled: true,
              transport: 'sse',
              url: 'https://${MCP_TEST_HOST}/sse',
              headers: { Authorization: 'Bearer ${env.MCP_TEST_HOST}' },
            },
          ]),
          'utf-8',
        )
        const [s] = await store.loadConfigFile(globalYaml, 'user')
        expect(s.url).toBe('https://example.test/sse')
        expect(s.headers?.Authorization).toBe('Bearer example.test')
      } finally {
        delete process.env.MCP_TEST_HOST
      }
    })

    it('过滤 __proto__ 等原型污染 key', async () => {
      const raw = `servers:
  - id: dirty
    name: Dirty
    enabled: true
    transport: stdio
    command: npx
    __proto__:
      polluted: true
`
      await fsp.writeFile(globalYaml, raw, 'utf-8')
      const [s] = await store.loadConfigFile(globalYaml, 'user')
      expect(s.id).toBe('dirty')
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect(Object.keys(s).includes('__proto__')).toBe(false)
    })
  })

  describe('loadConfig / findServer', () => {
    it('用户级整条覆盖同 id 的全局项', async () => {
      await fsp.writeFile(
        globalYaml,
        yamlOf([stdioCfg({ id: 'a', name: 'GlobalA' }), stdioCfg({ id: 'b', name: 'GlobalB' })]),
        'utf-8',
      )
      await fsp.writeFile(
        userYaml,
        yamlOf([stdioCfg({ id: 'b', name: 'UserB', enabled: false, source: 'user' })]),
        'utf-8',
      )

      await store.loadConfig()

      expect(store.configList).toHaveLength(2)
      const b = store.findServer('b')
      expect(b).toMatchObject({ name: 'UserB', enabled: false, source: 'user' })
      expect(store.findServer('a')).toMatchObject({ name: 'GlobalA', source: 'global' })
      expect(store.findServer('missing')).toBeUndefined()
    })

    it('resetConfig 清空内存配置', async () => {
      await fsp.writeFile(globalYaml, yamlOf([stdioCfg()]), 'utf-8')
      await store.loadConfig()
      expect(store.configList).toHaveLength(1)
      store.resetConfig()
      expect(store.configList).toEqual([])
    })
  })
  describe('readUserConfig / writeUserConfig', () => {
    it('readUserConfig 文件不存在返回空数组', async () => {
      expect(await store.readUserConfig()).toEqual([])
    })

    it('writeUserConfig 原子写入后可回读', async () => {
      await store.writeUserConfig([stdioCfg({ id: 'w1', source: 'user' })])
      const read = await store.readUserConfig()
      expect(read).toHaveLength(1)
      expect(read[0]).toMatchObject({ id: 'w1', transport: 'stdio' })
    })

    it('超过 1MB 上限时抛错', async () => {
      const big = stdioCfg({ id: 'big', name: 'x'.repeat(1_200_000) })
      await expect(store.writeUserConfig([big])).rejects.toThrow(/exceeds 1MB limit/)
    })
  })

  describe('addServer', () => {
    it('无效配置抛错', async () => {
      await expect(
        store.addServer({ id: 'x', name: 'X', enabled: true, transport: 'bogus' } as McpServerConfig),
      ).rejects.toThrow(/Invalid server config/)
    })

    it('非法字符 id 抛错', async () => {
      await expect(
        store.addServer(stdioCfg({ id: 'bad id!' })),
      ).rejects.toThrow(/invalid characters/)
    })

    it('重复 id 抛错', async () => {
      await fsp.writeFile(globalYaml, yamlOf([stdioCfg({ id: 'dup' })]), 'utf-8')
      await store.loadConfig()
      await expect(store.addServer(stdioCfg({ id: 'dup' }))).rejects.toThrow(/already exists/)
    })

    it('不安全 command 抛错', async () => {
      await expect(store.addServer(stdioCfg({ id: 'sh', command: 'sh; curl evil' }))).rejects.toThrow(
        /command failed safety check/,
      )
    })

    it('非 stdio 的危险 URL 抛 SSRF 错', async () => {
      await expect(
        store.addServer(
          stdioCfg({ id: 'meta', transport: 'sse', url: 'http://169.254.169.254/latest' }),
        ),
      ).rejects.toThrow(/url failed SSRF check/)
    })

    it('成功: 写入 mcp.user.yaml 并更新内存(source=user)', async () => {
      await store.addServer(stdioCfg({ id: 'fresh' }))

      const read = await store.readUserConfig()
      expect(read).toHaveLength(1)
      expect(read[0]).toMatchObject({ id: 'fresh', source: 'user' })
      expect(store.configList.map((s) => s.id)).toEqual(['fresh'])
    })

    it('enabled=false 的新增项也会持久化(不被静默过滤)', async () => {
      await store.addServer(stdioCfg({ id: 'disabled', enabled: false }))

      const read = await store.readUserConfig()
      expect(read).toHaveLength(1)
      expect(read[0]?.enabled).toBe(false)
      // 重新 loadConfig 后仍在内存中
      await store.loadConfig()
      expect(store.findServer('disabled')?.enabled).toBe(false)
    })
  })

  describe('serializeWrite', () => {
    it('串行执行: 后续操作等待前一个完成', async () => {
      const order: string[] = []
      const slow = store.serializeWrite(async () => {
        await new Promise((r) => setTimeout(r, 30))
        order.push('slow')
      })
      const fast = store.serializeWrite(async () => {
        order.push('fast')
      })
      await Promise.allSettled([slow, fast])
      expect(order).toEqual(['slow', 'fast'])
    })

    it('前一个失败不阻塞后续操作', async () => {
      const failing = store.serializeWrite(async () => {
        throw new Error('first fails')
      })
      await expect(failing).rejects.toThrow('first fails')

      const next = store.serializeWrite(async () => 'ok')
      await expect(next).resolves.toBe('ok')
    })
  })
})