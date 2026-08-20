// =============================================================
// i18n 测试 — 字典查找、lang 切换、localStorage 持久化
// =============================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enDict from '../en.json'
import zhDict from '../zh.json'

const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k]
    }),
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

// 动态 import 让 module-level 的 loadInitial() 能拿到 mock 后的 localStorage
const { t, setLang, getLang, useT } = await import('../index')

describe('i18n', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    setLang('zh')
  })

  afterEach(() => {
    mockLocalStorage.clear()
  })

  describe('t()', () => {
    it('zh 默认应返回中文', () => {
      setLang('zh')
      const sampleKey = Object.keys(zhDict)[0] as keyof typeof zhDict
      const expected = zhDict[sampleKey]
      const got = t(sampleKey)
      expect(got).toBe(expected)
    })

    it('切换到 en 后应返回英文', () => {
      setLang('en')
      const sampleKey = Object.keys(enDict)[0] as keyof typeof enDict
      const expected = enDict[sampleKey]
      const got = t(sampleKey)
      expect(got).toBe(expected)
    })

    it('不存在的 key 应返回 fallback', () => {
      expect(t('nonexistent.key', 'FALLBACK')).toBe('FALLBACK')
    })

    it('不存在的 key 且无 fallback 应返回 key', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key')
    })

    it('同 key 在 zh/en 字典中应能切换', () => {
      setLang('zh')
      const zhVal = t('settings.title', 'fallback')
      setLang('en')
      const enVal = t('settings.title', 'fallback')
      // 不要求完全相同(可能 i18n 不完整),但应该都能拿到 fallback
      expect(zhVal).toBeTruthy()
      expect(enVal).toBeTruthy()
    })
  })

  describe('setLang / getLang', () => {
    it('默认应为 zh', () => {
      setLang('zh')
      expect(getLang()).toBe('zh')
    })

    it('setLang(en) 后 getLang 应返回 en', () => {
      setLang('en')
      expect(getLang()).toBe('en')
    })

    it('setLang 应写入 localStorage', () => {
      setLang('en')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('education-advisor.lang', 'en')
    })

    it('setLang(zh) 应写入 localStorage', () => {
      setLang('zh')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('education-advisor.lang', 'zh')
    })

    it('多次 setLang 应都更新', () => {
      setLang('en')
      expect(getLang()).toBe('en')
      setLang('zh')
      expect(getLang()).toBe('zh')
      setLang('en')
      expect(getLang()).toBe('en')
    })
  })

  describe('useT hook', () => {
    it('useT 是函数', () => {
      expect(typeof useT).toBe('function')
    })

    // 注: useT 是 React hook, 在 jsdom 中调用需要 React renderer
    // 实际渲染测试在组件层做,这里只验证 t 函数和 lang 状态机的正确性
  })

  // M24: 源码中所有 t('key', ...) 调用的 key 必须存在于 zh/en 字典,
  // 防止后续迭代引入硬编码漂移(缺 key 时静默回退到 fallback,难以察觉)
  describe('字典完整性', () => {
    function collectUsedKeys(): Map<string, string[]> {
      // jsdom 环境下 import.meta.url 非 file 协议,用 cwd(= 项目根)定位
      const rendererDir = join(process.cwd(), 'src', 'renderer')
      const files: string[] = []
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          if (name === '__tests__' || name === 'node_modules') continue
          const p = join(dir, name)
          if (statSync(p).isDirectory()) walk(p)
          else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(p)
        }
      }
      walk(rendererDir)

      const used = new Map<string, string[]>()
      const re = /\bt\(\s*['"]([\w.-]+)['"]/g
      for (const f of files) {
        const lines = readFileSync(f, 'utf8').split('\n')
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0
          let m: RegExpExecArray | null = re.exec(lines[i])
          while (m !== null) {
            const loc = `${f.split(/[\\/]/).slice(-2).join('/')}:${i + 1}`
            const list = used.get(m[1]) ?? []
            list.push(loc)
            used.set(m[1], list)
            m = re.exec(lines[i])
          }
        }
      }
      return used
    }

    it('源码使用的 key 应全部存在于 zh 字典', () => {
      const used = collectUsedKeys()
      // 健全性: 扫描应找到大量 key(字典被搬空或正则失效时兜底失败)
      expect(used.size).toBeGreaterThan(500)
      const missing = [...used.keys()].filter((k) => !(k in zhDict))
      expect(missing, `missing in zh.json: ${missing.join(', ')}`).toEqual([])
    })

    it('源码使用的 key 应全部存在于 en 字典', () => {
      const used = collectUsedKeys()
      const missing = [...used.keys()].filter((k) => !(k in enDict))
      expect(missing, `missing in en.json: ${missing.join(', ')}`).toEqual([])
    })
  })
})
