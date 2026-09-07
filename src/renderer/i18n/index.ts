// =============================================================
// i18n — 极简国际化(zh / en)
// 字典: src/renderer/i18n/{zh,en}.json — 按语言懒加载(各成独立
// chunk): 原两本静态打包 ~183KB 全量进首屏,但任一时刻只用一本;
// 现启动仅加载当前语言,切换时按需加载另一本(本地磁盘毫秒级)。
// 顶层 await 保证任何导入方(模块求值顺序)拿到 t() 前字典已就绪,
// t()/useT() 保持同步语义,无 key 闪烁。
// 用法: const { t } = useT(); t('settings.title')
// 切换: setLang('en') — 异步加载目标字典后才翻转+广播 rerender
// =============================================================

import { useEffect, useState } from 'react'

export type Lang = 'zh' | 'en'

type Dict = Record<string, string>

const dictLoaders: Record<Lang, () => Promise<{ default: Dict }>> = {
  zh: () => import('./zh.json'),
  en: () => import('./en.json'),
}

/** 已加载字典注册表(内存缓存,每语言至多加载一次) */
const DICTS: Partial<Record<Lang, Dict>> = {}

async function ensureDict(lang: Lang): Promise<void> {
  if (!DICTS[lang]) DICTS[lang] = (await dictLoaders[lang]()).default
}

const LANG_KEY = 'education-advisor.lang'

/** 读 localStorage 偏好;无 window/storage 或值非法 → null */
function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(LANG_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    /* storage 不可用 */
  }
  return null
}

let currentLang: Lang = readStoredLang() ?? 'zh'

// 顶层 await(见头注释): 当前语言字典就绪后本模块才算加载完成
await ensureDict(currentLang)

/**
 * F1 自愈 — app:// 分区下 localStorage 的首次写入存在刷盘窗口(秒级):
 * boot 时 loadInitial 可能读到旧值把语言锁死(实测 en 用户 reload/
 * 重启后间歇性回退 zh,主布局与懒加载页渲染不一致;且窗口内新旧值可能
 * 恰好相等,"相等即不动作"的判定会漏过)。
 *
 * healLangFromStorage: 幂等单次检查——storage 有有效偏好且 ≠ 当前 →
 * 走 setLang 自愈(回写+广播)。由 startHealWatcher 在 boot 后的窗口期
 * 内周期调用(R17/R27 实测窗口为秒级,首帧数次调用覆盖不住);
 * 窗口过后以 setLang 事件为唯一变更通道。zh 用户全程 no-op。
 */
export async function healLangFromStorage(): Promise<void> {
  if (typeof window === 'undefined') return
  const stored = readStoredLang()
  if (stored && stored !== currentLang) await setLang(stored)
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
    const stored = readStoredLang()
    if (stored && stored !== currentLang) {
      clearInterval(timer)
      void healLangFromStorage()
      return
    }
    if (Date.now() - t0 > HEAL_WINDOW_MS) clearInterval(timer)
  }, HEAL_POLL_MS)
}

function getDict(lang: Lang): Dict {
  return DICTS[lang] ?? DICTS.zh ?? {}
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

/** 切换序号: 快速连续切换时丢弃过期完成(后发先至防护) */
let setLangSeq = 0

export async function setLang(lang: Lang): Promise<void> {
  const seq = ++setLangSeq
  await ensureDict(lang)
  if (seq !== setLangSeq) return
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
        // 事件与模块态不一致 → 走 setLang 规范通道(先 ensureDict 再翻转+再广播)。
        // 懒字典下直接翻 currentLang 会让 t() 落在未加载字典上(裸 key/整页 fallback) —
        // 外到场切换(setItem+裸事件,如审计脚本)依赖本防护。再广播到达时
        // currentLang === next,落入下方同步路径,无环。
        if (currentLang !== next) {
          void setLang(next)
          return
        }
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
