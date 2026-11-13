import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

// 工具注册表经 service → utils/log 链在模块顶层调用 app.getPath('userData')；
// 本测试跑在无 electron 的 node 项目里，与 tests/main 的既有做法一致补桩。
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/eaa-dsh-schema-test'),
    isPackaged: false,
  },
}))

import { escalateParams } from '../../agent/escalation-tool'
import { allEAATools, dangerousEAATools } from '../../eaa/tools/registry'
import { allFileTools } from '../../file-tools'
import { allUtilityTools } from '../../utility-tools'
import { toDshToolInputSchema } from '../dsh-json-schema'

const SUPPORTED = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
])

function unsupportedKeywords(node: unknown, path: string, found: string[]): void {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries())
      unsupportedKeywords(item, `${path}[${index}]`, found)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!SUPPORTED.has(key)) found.push(`${path}.${key}`)
  }
  if (record.oneOf && record.type) found.push(`${path} type beside oneOf`)
  if (
    record.additionalProperties !== undefined &&
    typeof record.additionalProperties !== 'boolean'
  ) {
    found.push(`${path}.additionalProperties`)
  }
  if (record.properties && typeof record.properties === 'object') {
    for (const [name, property] of Object.entries(record.properties as Record<string, unknown>)) {
      unsupportedKeywords(property, `${path}.${name}`, found)
    }
  }
  if (record.items) unsupportedKeywords(record.items, `${path}.items`, found)
  if (record.oneOf) unsupportedKeywords(record.oneOf, `${path}.oneOf`, found)
  if (
    Array.isArray(record.required) &&
    record.properties &&
    typeof record.properties === 'object'
  ) {
    for (const name of record.required) {
      if (typeof name === 'string' && !(name in (record.properties as object))) {
        found.push(`${path}.required:${name}`)
      }
    }
  }
}

describe('toDshToolInputSchema', () => {
  it('把 TypeBox 的 anyOf 收成 dsh 接受的 oneOf，并丢掉 pattern', () => {
    const schema = toDshToolInputSchema(
      Type.Object({
        score: Type.Union([Type.Number(), Type.Null()]),
        mode: Type.Union([Type.Literal('strict'), Type.Literal('normal')]),
        path: Type.String({ pattern: '^C:', minLength: 1, description: '路径' }),
      }),
    )
    expect(JSON.stringify(schema)).not.toContain('anyOf')
    const properties = schema.properties as Record<string, Record<string, unknown>>
    expect(properties.path.pattern).toBeUndefined()
    expect(properties.path.minLength).toBeUndefined()
    expect(properties.score.oneOf).toEqual([{ type: 'number' }, { type: 'null' }])
    expect(properties.mode.oneOf).toEqual([
      { type: 'string', const: 'strict' },
      { type: 'string', const: 'normal' },
    ])
    expect(properties.path.description).toContain('路径')
    expect(properties.path.description).toContain('pattern: ^C:')
    expect(properties.path.description).toContain('minLength: 1')
  })

  it('全部会挂给 DSH 的工具参数都落在它接受的子集里', () => {
    const tools = [
      ...allEAATools,
      ...dangerousEAATools,
      ...allFileTools,
      ...allUtilityTools,
      { name: 'escalate_to_main', parameters: escalateParams },
    ]
    const problems: string[] = []
    for (const tool of tools) {
      const schema = toDshToolInputSchema(tool.parameters)
      const found: string[] = []
      unsupportedKeywords(schema, tool.name, found)
      for (const item of found) problems.push(item)
    }
    expect(problems).toEqual([])
  })

  it('空的或读不了的 schema 变成空对象', () => {
    expect(toDshToolInputSchema(undefined)).toEqual({ type: 'object', properties: {} })
    expect(toDshToolInputSchema('nope')).toEqual({ type: 'object', properties: {} })
  })
})
