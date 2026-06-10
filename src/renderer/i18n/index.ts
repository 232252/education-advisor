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

/**
 * 翻译函数 — 支持 {0} {1} 占位符
 * @example t('page.student.eventsCount', String(5)) → "5 事件"
 * @example t('page.feishu.testSuccess', token, String(7200)) → "连接成功 · token=xxx · 过期 7200s"
 */
export function t(key: string, ...args: unknown[]): string {
  const dict = getDict(currentLang)
  let template = dict[key] ?? key
  if (args.length > 0) {
    template = template.replace(/\{(\d+)\}/g, (_, idx) => {
      const v = args[Number(idx)]
      return v == null ? '' : String(v)
    })
  }
  return template
}

export function setLang(lang: Lang): void {
  currentLang = lang
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('i18n-changed', { detail: lang }))
  }
}

export function getLang(): Lang {
  return currentLang
}

/** React hook: 返回 t 函数 + 当前 lang, lang 变化时自动 rerender */
export function useT(): { t: (key: string, ...args: unknown[]) => string; lang: Lang } {
  const [lang, setLangState] = useState<Lang>(currentLang)
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent).detail as Lang
      if (next === 'zh' || next === 'en') setLangState(next)
    }
    window.addEventListener('i18n-changed', handler)
    return () => window.removeEventListener('i18n-changed', handler)
  }, [])
  return { t, lang }
}
