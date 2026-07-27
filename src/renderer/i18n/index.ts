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

export function t(key: string, fallback?: string): string {
  const dict = getDict(currentLang)
  return dict[key] ?? fallback ?? key
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
