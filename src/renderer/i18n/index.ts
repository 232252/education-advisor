// =============================================================
// i18n — 极简国际化(zh / en)
// 字典: src/renderer/i18n/{zh,en}.json
// 用法: const { t } = useT(); t('settings.title')
// 切换: setLang('en') 自动触发 React rerender
// =============================================================

import { useEffect, useState } from 'react'
import en from './en.json'
import zh from './zh.json'

export type Lang = 'zh' | 'en'

type Dict = Record<string, string>
const DICTS: Record<Lang, Dict> = { zh, en }

const LANG_KEY = 'education-advisor.lang'
let currentLang: Lang = loadInitial()

/**
 * F1 自愈 — app:// 分区下 localStorage 的首次写入存在刷盘窗口(秒级):
 * boot 时 loadInitial() 可能读到旧值把语言锁死(实测 en 用户 reload/
 * 重启后间歇性回退 zh,主布局与懒加载页渲染不一致;且窗口内新旧值可能
 * 恰好相等,"相等即不动作"的判定会漏过)。
 *
 * healLangFromStorage: 幂等单次检查——storage 有有效偏好且 ≠ 当前 →
 * 走 setLang 自愈(回写+广播)。由 startHealWatcher 在 boot 后的窗口期
 * 内周期调用(R17/R27 实测窗口为秒级,首帧数次调用覆盖不住);
 * 窗口过后以 setLang 事件为唯一变更通道。zh 用户全程 no-op。
 */
export function healLangFromStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const stored = window.localStorage.getItem(LANG_KEY)
    if ((stored === 'zh' || stored === 'en') && stored !== currentLang) setLang(stored)
  } catch {
    /* storage 不可用时保持当前语言 */
  }
}

/** boot 后的自愈窗口与轮询间隔(实测刷盘窗口为秒级,10s 冗余充足) */
const HEAL_WINDOW_MS = 10_000
const HEAL_POLL_MS = 500
let healWatcherStarted = false

/** 启动自愈观察(main.tsx 调用一次);自愈成功或超时即停止轮询 */
export function startHealWatcher(): void {
  if (healWatcherStarted || typeof window === 'undefined') return
  healWatcherStarted = true
  const t0 = Date.now()
  const timer = setInterval(() => {
    const expired = Date.now() - t0 > HEAL_WINDOW_MS
    try {
      const stored = window.localStorage.getItem(LANG_KEY)
      if ((stored === 'zh' || stored === 'en') && stored !== currentLang) {
        clearInterval(timer)
        setLang(stored)
        return
      }
    } catch {
      /* storage 不可用 */
    }
    if (expired) clearInterval(timer)
  }, HEAL_POLL_MS)
}

function loadInitial(): Lang {
  if (typeof window === 'undefined') return 'zh'
  try {
    const stored = window.localStorage.getItem(LANG_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    /* ignore */
  }
  return 'zh'
}

function getDict(lang: Lang): Dict {
  return DICTS[lang] ?? DICTS.zh
}

export function t(key: string, fallback?: string): string {
  const dict = getDict(currentLang)
  return dict[key] ?? fallback ?? key
}

/**
 * t(key) + 占位符替换的单一来源: tr('a.b', { name }) 替换文案中的 {name},
 * tr('a.b', { 0: n, 1: m }) 替换 {0}/{1}(数字键合法,JS 对象整型键自动字符串化)。
 * 取代散落 60+ 处的 `.replace('{x}', …)` 链 — 占位符名与字典条目解耦,
 * 字典改占位符名时调用点不再静默漏替换。
 */
export function tr(key: string, vars: Record<string, string | number>, fallback?: string): string {
  let out = t(key, fallback)
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(value))
  }
  return out
}

export function setLang(lang: Lang): void {
  currentLang = lang
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    // 同步 <html lang> 属性, 避免静态 "zh-CN" 不随 i18n 切换更新
    // (zh -> "zh-CN", en -> "en" 保持 BCP47 合规)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    }
    window.dispatchEvent(new CustomEvent('i18n-changed', { detail: lang }))
  }
}

/** 应用启动时同步 <html lang> 到当前语言 (修复静态 "zh-CN" 不更新问题) */
export function initHtmlLang(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en'
  }
}

export function getLang(): Lang {
  return currentLang
}

/** React hook: 返回 t 函数 + 当前 lang, lang 变化时自动 rerender */
export function useT(): { t: (key: string, fallback?: string) => string; lang: Lang } {
  const [lang, setLangState] = useState<Lang>(currentLang)
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent).detail as Lang
      if (next === 'zh' || next === 'en') {
        // 防御性同步: 确保事件触发(即使不经 setLang)时模块级 currentLang 也更新
        // 否则 t() 闭包会读取旧 currentLang, 导致切换后内容不变
        currentLang = next
        // 同步 <html lang> 属性, 与 setLang()/initHtmlLang() 保持一致
        // (zh -> "zh-CN", en -> "en" 保持 BCP47 合规)
        if (typeof document !== 'undefined') {
          document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
        }
        setLangState(next)
      }
    }
    window.addEventListener('i18n-changed', handler)
    return () => window.removeEventListener('i18n-changed', handler)
  }, [])
  return { t, lang }
}
