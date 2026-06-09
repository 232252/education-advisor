// =============================================================
// useTheme — 主题管理 Hook（dark / light / system）
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

type ThemeSetting = 'dark' | 'light' | 'system'
type EffectiveTheme = 'dark' | 'light'

function getSystemPreference(): EffectiveTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

function applyTheme(effective: EffectiveTheme): void {
  const root = document.documentElement
  if (effective === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function useTheme(): EffectiveTheme {
  const [effective, setEffective] = useState<EffectiveTheme>(() => {
    // Default to dark until settings load
    return 'dark'
  })

  const applyFromSetting = useCallback((setting: ThemeSetting) => {
    let resolved: EffectiveTheme
    if (setting === 'system') {
      resolved = getSystemPreference()
    } else {
      resolved = setting
    }
    applyTheme(resolved)
    setEffective(resolved)
  }, [])

  useEffect(() => {
    // Load theme from settings on mount
    let mounted = true
    // 缓存上次的 theme setting，避免系统主题变化时重复 IPC 调用
    let cachedSetting: ThemeSetting = 'dark'

    const loadTheme = async () => {
      try {
        const settings = await getAPI().settings.get()
        if (mounted) {
          cachedSetting = settings.general.theme as ThemeSetting
          applyFromSetting(cachedSetting)
        }
      } catch {
        // Fallback to dark if settings load fails
        if (mounted) {
          applyFromSetting('dark')
        }
      }
    }

    loadTheme()

    // Listen for system preference changes (for 'system' mode)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = () => {
      // 直接用缓存的 setting 判断，无需再 IPC 调用
      if (mounted && cachedSetting === 'system') {
        applyFromSetting('system')
      }
    }
    mediaQuery.addEventListener('change', handleMediaChange)

    // Listen for custom theme-changed event from SettingsPage
    const handleThemeChanged = (e: Event) => {
      const newTheme = (e as CustomEvent).detail as ThemeSetting
      cachedSetting = newTheme
      if (mounted) {
        applyFromSetting(newTheme)
      }
    }
    window.addEventListener('theme-changed', handleThemeChanged)

    return () => {
      mounted = false
      mediaQuery.removeEventListener('change', handleMediaChange)
      window.removeEventListener('theme-changed', handleThemeChanged)
    }
  }, [applyFromSetting])

  return effective
}
