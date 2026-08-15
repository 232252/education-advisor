// =============================================================
// settings/ 拆分模块测试 — defaults / merge / validation / persistence
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import fs from 'node:fs'

import { DEFAULT_SETTINGS } from '../../src/main/services/settings/defaults'
import { deepMerge, loadOrDefaultSync } from '../../src/main/services/settings/merge'
import { validateUpdate, getObjectDepth } from '../../src/main/services/settings/validation'
import {
  scheduleSave,
  saveNow,
  flush,
  type PersistenceState,
} from '../../src/main/services/settings/persistence'

const sep = process.platform === 'win32' ? '\\' : '/'
const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
const tmpDir = `${tmpBase}${sep}settings-mods-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true })
})
afterAll(async () => {
  try {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('settings/defaults — DEFAULT_SETTINGS', () => {
  it('补全 JSON 未收录的类型必需字段', () => {
    expect(DEFAULT_SETTINGS.models.providerBlacklist).toEqual([])
    expect(DEFAULT_SETTINGS.models.customModels).toEqual({})
    expect(DEFAULT_SETTINGS.chat.conversationLogging).toBe(true)
  })

  it('包含 schema 校验依赖的常见路径', () => {
    expect(typeof DEFAULT_SETTINGS.general.theme).toBe('string')
    expect(typeof DEFAULT_SETTINGS.general.autoStart).toBe('boolean')
    expect(Array.isArray(DEFAULT_SETTINGS.models.enabledModels)).toBe(true)
  })
})

describe('settings/merge — deepMerge', () => {
  it('原始值直接覆盖,嵌套对象递归合并', () => {
    const target = { a: 1, b: { x: 1, y: 2 }, c: 'old' }
    const source = { b: { y: 3, z: 4 }, c: 'new' }
    const r = deepMerge(target, source)
    expect(r).toEqual({ a: 1, b: { x: 1, y: 3, z: 4 }, c: 'new' })
  })

  it('数组直接覆盖不递归', () => {
    const r = deepMerge({ arr: [1, 2, 3] }, { arr: [9] })
    expect(r.arr).toEqual([9])
  })

  it('source 中的对象覆盖 target 中的原始值', () => {
    const r = deepMerge({ a: 1 }, { a: { b: 2 } })
    expect(r.a).toEqual({ b: 2 })
  })

  it('不修改 target 本身', () => {
    const target = { b: { x: 1 } }
    deepMerge(target, { b: { x: 2 } })
    expect(target.b.x).toBe(1)
  })
})

describe('settings/merge — loadOrDefaultSync', () => {
  it('文件不存在返回默认值深拷贝', () => {
    const p = path.join(tmpDir, 'missing-settings.json')
    const s = loadOrDefaultSync(p)
    expect(s.general.theme).toBe(DEFAULT_SETTINGS.general.theme)
    // 深拷贝: 修改返回值不影响 DEFAULT_SETTINGS
    s.general.language = 'MUTATED'
    s.chat.compaction.enabled = false
    expect(DEFAULT_SETTINGS.general.language).not.toBe('MUTATED')
    expect(DEFAULT_SETTINGS.chat.compaction.enabled).toBe(true)
  })

  it('存在文件时与默认值深度合并(用户覆盖默认)', () => {
    const p = path.join(tmpDir, 'user-settings.json')
    fs.writeFileSync(p, JSON.stringify({ general: { theme: 'dark' } }), 'utf-8')
    const s = loadOrDefaultSync(p)
    expect(s.general.theme).toBe('dark')
    // 未覆盖字段保留默认
    expect(s.general.language).toBe(DEFAULT_SETTINGS.general.language)
  })

  it('JSON 损坏时回退默认值', () => {
    const p = path.join(tmpDir, 'corrupt-settings.json')
    fs.writeFileSync(p, '{not valid json', 'utf-8')
    const s = loadOrDefaultSync(p)
    expect(s.general.theme).toBe(DEFAULT_SETTINGS.general.theme)
  })
})

describe('settings/validation — validateUpdate', () => {
  it('接受合法的 string/boolean/number/array 路径', () => {
    expect(() => validateUpdate('general.theme', 'dark')).not.toThrow()
    expect(() => validateUpdate('general.autoStart', true)).not.toThrow()
    expect(() => validateUpdate('models.retry.maxRetries', 5)).not.toThrow()
    expect(() => validateUpdate('models.enabledModels', ['a', 'b'])).not.toThrow()
  })

  it('拒绝空/含空段的 dotPath', () => {
    expect(() => validateUpdate('', 'x')).toThrow('non-empty string')
    expect(() => validateUpdate('a..b', 'x')).toThrow('empty segment')
    expect(() => validateUpdate('general.', 'x')).toThrow('empty segment')
  })

  it('拒绝原型链污染 key', () => {
    expect(() => validateUpdate('__proto__.polluted', 1)).toThrow('dangerous key')
    expect(() => validateUpdate('constructor.prototype', 1)).toThrow('dangerous key')
    expect(() => validateUpdate('a.prototype', 1)).toThrow('dangerous key')
  })

  it('拒绝 undefined/null/function/symbol/bigint', () => {
    expect(() => validateUpdate('general.theme', undefined)).toThrow('Invalid value type')
    expect(() => validateUpdate('general.theme', null)).toThrow('Invalid value type')
    expect(() => validateUpdate('general.theme', () => {})).toThrow('Invalid value type')
    expect(() => validateUpdate('general.theme', Symbol('s'))).toThrow('Invalid value type')
    expect(() => validateUpdate('general.theme', 10n)).toThrow('Invalid value type')
  })

  it('拒绝 NaN/Infinity', () => {
    expect(() => validateUpdate('models.retry.maxRetries', Number.NaN)).toThrow('NaN/Infinity')
    expect(() => validateUpdate('models.retry.maxRetries', Number.POSITIVE_INFINITY)).toThrow('NaN/Infinity')
  })

  it('拒绝超长字符串', () => {
    expect(() => validateUpdate('general.theme', 'x'.repeat(1_000_001))).toThrow('too long')
  })

  it('拒绝嵌套过深的对象', () => {
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 15; i++) deep = { a: deep }
    expect(() => validateUpdate('advanced', deep)).toThrow('too deep')
  })

  it('拒绝默认设置中不存在的路径(typo 防护)', () => {
    expect(() => validateUpdate('general.notExist', 1)).toThrow('not found')
    expect(() => validateUpdate('nope.x', 1)).toThrow('not found')
  })

  it('拒绝穿越非对象中间节点', () => {
    expect(() => validateUpdate('general.theme.sub', 1)).toThrow('parent is not object')
  })

  it('拒绝与默认值类型不一致的值(R150)', () => {
    expect(() => validateUpdate('general.theme', 123)).toThrow('Type mismatch')
    expect(() => validateUpdate('general.autoStart', 'yes')).toThrow('Type mismatch')
    // 数组性不一致
    expect(() => validateUpdate('general.theme', ['a'])).toThrow('expected non-array, got array')
    expect(() => validateUpdate('models.enabledModels', 'not-array')).toThrow(
      'expected array, got non-array',
    )
  })
})

describe('settings/validation — getObjectDepth', () => {
  it('原始值返回 0,空对象返回 1,嵌套逐层 +1', () => {
    expect(getObjectDepth(42)).toBe(0)
    expect(getObjectDepth('x')).toBe(0)
    expect(getObjectDepth(null)).toBe(0)
    expect(getObjectDepth({})).toBe(1)
    expect(getObjectDepth({ a: {} })).toBe(2)
    expect(getObjectDepth({ a: { b: { c: 1 } } })).toBe(3)
    // 取各分支最大深度
    expect(getObjectDepth({ a: { b: 1 }, c: { d: { e: 1 } } })).toBe(3)
  })

  it('循环引用返回有限值不无限递归', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    expect(getObjectDepth(obj)).toBe(1)
  })
})

describe('settings/persistence — scheduleSave/saveNow/flush', () => {
  function makeState(): PersistenceState {
    return {
      settingsPath: path.join(tmpDir, `s-${Math.random().toString(36).slice(2, 8)}.json`),
      saveTimer: null,
      writing: false,
      needsResave: false,
      lastError: null,
    }
  }

  it('saveNow: 原子写入 settings.json', async () => {
    const state = makeState()
    const settings = { general: { theme: 'dark' } }
    await saveNow(state, () => settings as never)
    expect(state.lastError).toBeNull()
    expect(state.writing).toBe(false)
    const written = JSON.parse(await fsp.readFile(state.settingsPath, 'utf-8'))
    expect(written.general.theme).toBe('dark')
    // 临时文件已被 rename,目录中无残留 .tmp
    const files = await fsp.readdir(tmpDir)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('saveNow: 写入失败时记录 lastError 且不抛出', async () => {
    const state = makeState()
    state.settingsPath = path.join(tmpDir, 'bad\0path.json')
    await saveNow(state, () => ({}) as never)
    expect(state.lastError).toContain('Failed to save settings')
    expect(state.writing).toBe(false)
  })

  it('saveNow: 写入进行中标记 needsResave 并重写最新状态', async () => {
    const state = makeState()
    let version = 1
    const getSettings = vi.fn(() => ({ version }) as never)

    const p1 = saveNow(state, getSettings)
    const p2 = saveNow(state, getSettings) // 看到 writing=true → needsResave
    version = 2
    await Promise.all([p1, p2])

    expect(state.needsResave).toBe(false)
    const written = JSON.parse(await fsp.readFile(state.settingsPath, 'utf-8'))
    expect(written.version).toBe(2)
  })

  it('scheduleSave(immediate=true): 立即写盘', async () => {
    const state = makeState()
    scheduleSave(state, () => ({ x: 1 }) as never, true)
    expect(state.saveTimer).toBeNull()
    // 等待异步写完成
    await flush(state, () => ({ x: 1 }) as never)
    expect(fs.existsSync(state.settingsPath)).toBe(true)
  })

  it('scheduleSave(默认): 300ms 节流合并写入', async () => {
    const state = makeState()
    scheduleSave(state, () => ({ a: 1 }) as never)
    expect(state.saveTimer).not.toBeNull()
    // 节流期内文件尚未写入
    expect(fs.existsSync(state.settingsPath)).toBe(false)
    await sleep(450)
    expect(state.saveTimer).toBeNull()
    expect(fs.existsSync(state.settingsPath)).toBe(true)
  })

  it('scheduleSave: 重复调用重置定时器(合并为一次写入)', async () => {
    const state = makeState()
    const getSettings = vi.fn(() => ({}) as never)
    scheduleSave(state, getSettings)
    await sleep(150)
    scheduleSave(state, getSettings) // 重置 300ms 窗口
    await sleep(200)
    expect(fs.existsSync(state.settingsPath)).toBe(false)
    await sleep(250)
    expect(fs.existsSync(state.settingsPath)).toBe(true)
  })

  it('flush: 清空待写定时器并立即落盘', async () => {
    const state = makeState()
    scheduleSave(state, () => ({ flushed: true }) as never)
    await flush(state, () => ({ flushed: true }) as never)
    expect(state.saveTimer).toBeNull()
    const written = JSON.parse(await fsp.readFile(state.settingsPath, 'utf-8'))
    expect(written.flushed).toBe(true)
  })

  it('flush: 无待写内容时直接返回', async () => {
    const state = makeState()
    await expect(flush(state, () => ({}) as never)).resolves.toBeUndefined()
    expect(fs.existsSync(state.settingsPath)).toBe(false)
  })
})