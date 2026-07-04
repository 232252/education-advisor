// =============================================================
// ThemeToggle — 全局主题切换按钮 (深色 ⇄ 浅色)
// 放置在侧边栏底部,任意界面均可一键切换。
// 复用 settings.general.theme 持久化 + 'theme-changed' 自定义事件,
// 因此与 SettingsPage 的下拉框以及 useTheme hook 完全联动。
// =============================================================

import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { getAPI } from '../lib/ipc-client'

type EffectiveTheme = 'dark' | 'light'

function readEffective(): EffectiveTheme {
  // <html> 上的 .dark class 是 useTheme hook 维护的唯一真实状态
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function ThemeToggle() {
  const { t } = useT()
  const [effective, setEffective] = useState<EffectiveTheme>(readEffective)

  // 监听 useTheme / SettingsPage 发出的主题变化,保持图标同步
  useEffect(() => {
    const sync = (e: Event) => {
      // 从事件 detail 读目标主题(比读 <html> class 更可靠,避免与 useTheme 的竞态)
      const detail = (e as CustomEvent).detail as EffectiveTheme | undefined
      if (detail === 'dark' || detail === 'light') {
        setEffective(detail)
      } else {
        // fallback: detail 缺失时读 DOM 实际状态(system 模式切换会走这里)
        setEffective(readEffective())
      }
    }
    window.addEventListener('theme-changed', sync as EventListener)
    return () => window.removeEventListener('theme-changed', sync as EventListener)
  }, [])

  const toggle = async () => {
    const next: EffectiveTheme = effective === 'dark' ? 'light' : 'dark'
    // 立即更新本地 state,不依赖事件回流(避免与 useTheme 的监听器竞态)
    setEffective(next)
    try {
      await getAPI().settings.set('general.theme', next)
    } catch (err) {
      console.error('[ThemeToggle] persist failed:', err)
    }
    // 通知 useTheme 立即应用,并让 SettingsPage 下拉框同步
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: next }))
  }

  const isDark = effective === 'dark'
  const label = isDark ? t('theme.toggle.toLight') : t('theme.toggle.toDark')

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex items-center gap-2 w-full px-3 py-2 text-xs rounded-lg
        text-gray-500 dark:text-gray-400
        hover:bg-gray-100 dark:hover:bg-gray-800
        hover:text-gray-700 dark:hover:text-gray-200
        transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {isDark ? (
        // 太阳图标 — 当前深色,点击切到浅色
        <svg
          className="w-4 h-4 text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          role="img"
          aria-hidden="true"
        >
          <title>{label}</title>
          <circle cx="12" cy="12" r="4" />
          <path
            strokeLinecap="round"
            d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"
          />
        </svg>
      ) : (
        // 月亮图标 — 当前浅色,点击切到深色
        <svg
          className="w-4 h-4 text-indigo-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          role="img"
          aria-hidden="true"
        >
          <title>{label}</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
          />
        </svg>
      )}
      <span>{isDark ? t('settings.theme.light') : t('settings.theme.dark')}</span>
    </button>
  )
}
