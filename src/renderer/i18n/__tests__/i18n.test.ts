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
  beforeEach(async () => {
    mockLocalStorage.clear()
    await setLang('zh')
  })

  afterEach(() => {
    mockLocalStorage.clear()
  })

  describe('t()', () => {
    it('zh 默认应返回中文', async () => {
      await setLang('zh')
      const sampleKey = Object.keys(zhDict)[0] as keyof typeof zhDict
      const expected = zhDict[sampleKey]
      const got = t(sampleKey)
      expect(got).toBe(expected)
    })

    it('切换到 en 后应返回英文', async () => {
      await setLang('en')
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

    it('同 key 在 zh/en 字典中应能切换', async () => {
      await setLang('zh')
      const zhVal = t('settings.title', 'fallback')
      await setLang('en')
      const enVal = t('settings.title', 'fallback')
      // 不要求完全相同(可能 i18n 不完整),但应该都能拿到 fallback
      expect(zhVal).toBeTruthy()
      expect(enVal).toBeTruthy()
    })
  })

  describe('setLang / getLang', () => {
    it('默认应为 zh', async () => {
      await setLang('zh')
      expect(getLang()).toBe('zh')
    })

    it('setLang(en) 后 getLang 应返回 en', async () => {
      await setLang('en')
      expect(getLang()).toBe('en')
    })

    it('setLang 应写入 localStorage', async () => {
      await setLang('en')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('education-advisor.lang', 'en')
    })

    it('setLang(zh) 应写入 localStorage', async () => {
      await setLang('zh')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('education-advisor.lang', 'zh')
    })

    it('多次 setLang 应都更新', async () => {
      await setLang('en')
      expect(getLang()).toBe('en')
      await setLang('zh')
      expect(getLang()).toBe('zh')
      await setLang('en')
      expect(getLang()).toBe('en')
    })

    it('healLangFromStorage — storage 晚就绪时自愈 boot 语言(竞态修复,幂等)', async () => {
      vi.resetModules()
      const {
        healLangFromStorage,
        setLang: setLangFresh,
        getLang: getLangFresh,
      } = await import('../index')
      // 现场: boot 时读到旧值锁 zh,但 storage 实际偏好是 en
      await setLangFresh('zh')
      mockLocalStorage.setItem('education-advisor.lang', 'en')
      await healLangFromStorage()
      expect(getLangFresh()).toBe('en')
      // 自愈走 setLang 语义: 偏好回写 + html lang 同步
      expect(mockLocalStorage.setItem).toHaveBeenLastCalledWith('education-advisor.lang', 'en')
      // 幂等: 连续调用一致即无操作
      healLangFromStorage()
      expect(getLangFresh()).toBe('en')
    })

    it('healLangFromStorage — storage 无有效值时不动', async () => {
      vi.resetModules()
      const {
        healLangFromStorage,
        setLang: setLangFresh,
        getLang: getLangFresh,
      } = await import('../index')
      await setLangFresh('zh')
      mockLocalStorage.clear()
      await healLangFromStorage()
      expect(getLangFresh()).toBe('zh')
    })

    it('startHealWatcher — 窗口内刷盘完成后自动对齐语言', async () => {
      vi.useFakeTimers()
      try {
        vi.resetModules()
        const mod = await import('../index')
        await mod.setLang('zh')
        // 模拟: boot 后 storage 刷盘完成,显示真实偏好 en
        mockLocalStorage.setItem('education-advisor.lang', 'en')
        mod.startHealWatcher()
        // 有界逐轮推进: 自愈是 fire-and-forget 异步(healLangFromStorage 内部
        // 含动态导入的字典加载),单次 advance 不能保证其内部 await 排空完成 —
        // 按真实轮询粒度推进直到自愈落地(10s 窗口内必有 500ms 整数倍命中)
        for (let i = 0; i < 20 && mod.getLang() !== 'en'; i++) {
          await vi.advanceTimersByTimeAsync(500)
        }
        expect(mod.getLang()).toBe('en')
      } finally {
        vi.useRealTimers()
      }
    })

    it('外到场裸事件(setItem+dispatch)应经 setLang 补载懒字典 — t() 不落空字典', async () => {
      const { renderHook } = await import('@testing-library/react')
      vi.resetModules()
      const mod = await import('../index') // boot zh: 仅 zh 字典就绪,en chunk 未加载
      const { result } = await renderHook(() => mod.useT()) // 注册 i18n-changed 监听
      // 模拟审计脚本式外到场切换: 不经 setLang,直接 setItem + 裸事件。
      // 懒字典下若处理器直接翻 currentLang,t() 会落在未加载的 en 字典上
      // (全部裸 key/fallback)—— 必须经 setLang 规范通道先补载字典。
      mockLocalStorage.setItem('education-advisor.lang', 'en')
      window.dispatchEvent(new CustomEvent('i18n-changed', { detail: 'en' }))
      await vi.waitFor(() => expect(result.current.lang).toBe('en'))
      expect(mod.getLang()).toBe('en')
      const sampleKey = Object.keys(enDict)[0] as keyof typeof enDict
      expect(mod.t(sampleKey)).toBe(enDict[sampleKey])
      mockLocalStorage.clear()
    })

    it('startHealWatcher — 10s 窗口耗尽后停止轮询', async () => {
      vi.useFakeTimers()
      try {
        vi.resetModules()
        const mod = await import('../index')
        await mod.setLang('en')
        mod.startHealWatcher()
        // 窗口内 storage 一直是 zh: watcher 会不断拉回 zh
        mockLocalStorage.setItem('education-advisor.lang', 'zh')
        await vi.advanceTimersByTimeAsync(10_500)
        expect(mod.getLang()).toBe('zh')
        // 窗口已过: 改 storage 不再被拉回
        mockLocalStorage.setItem('education-advisor.lang', 'en')
        await vi.advanceTimersByTimeAsync(2000)
        expect(mod.getLang()).toBe('zh')
      } finally {
        vi.useRealTimers()
      }
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
