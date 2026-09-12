// =============================================================
// 系统设置页面
//   - 7 个 Section 已抽出至 ./sections/ 目录:
//       General / Chat / Mcp / Feishu / Diagnostic / Log / About
//   - 共享 UI 原语(Section / SettingRow / ToggleSwitch / SecretInput / HintIcon)
//     已抽出至 ./components/ 目录
//   - 本文件保留: 状态(state/useReducer)+ 加载/保存/重置 handler +
//     ConfirmDialog 统一弹窗 + 头部标题/语言切换/重置按钮
//   - mergeSettings: 深合并默认值,防止嵌套字段在后端迁移/升级后缺失导致白屏
// =============================================================

import { deepMergeSettings } from '@shared/deep-merge'
import type { UnifiedSettings } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import DEFAULT_SETTINGS_JSON from '../../../../config/default-settings.json'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import { useT } from '../../i18n'
import { errText, getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import {
  AboutSection,
  ChannelsSection,
  ChatSection,
  DataSection,
  DiagnosticSection,
  GeneralSection,
  LogSection,
  McpSection,
  MemorySection,
  WebUiSection,
} from './sections'

/**
 * 深合并:以后端 settings 覆盖默认 settings 的对应层,确保所有嵌套字段存在
 * (UI-1 修复;undefined 跳过/递归规则统一见 @shared/deep-merge,与主进程同源)。
 */
function mergeSettings(
  defaults: Partial<UnifiedSettings> | null | undefined,
  partial: Partial<UnifiedSettings> | null | undefined,
): UnifiedSettings {
  return deepMergeSettings(
    (defaults ?? {}) as Record<string, unknown>,
    (partial ?? {}) as Record<string, unknown>,
  ) as unknown as UnifiedSettings
}

// 完整默认 settings(从 config/default-settings.json 导入,作为缺字段兜底)
const DEFAULT_SETTINGS = DEFAULT_SETTINGS_JSON as unknown as UnifiedSettings

export function SettingsPage() {
  const { t, lang } = useT()
  const [settings, setSettings] = useState<UnifiedSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // M4 修复: 记录加载失败原因,配合下方错误态渲染 + 重试按钮
  const [loadError, setLoadError] = useState<string | null>(null)
  // Feishu/Log 的全部 UI 状态与清空日志确认框已下沉到各自 Section(2026-09-05)
  // 接入 useConfirmDialog: 独立 dialog 替代原先手写的
  // useState<'reset' | 'clearLogs' | null> 共用一个 ConfirmDialog 的判别联合模式
  const resetConfirm = useConfirmDialog<void>()

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const s = await getAPI().settings.get()
      // UI-1 修复: 深合并默认值,防止嵌套字段(如 feishu.bitableSync / chat.compaction /
      // general.theme / mcp 等)在后端迁移/升级后缺失,导致 settings.feishu.bitableSync.enabled
      // 等嵌套访问触发 "Cannot read properties of undefined" 而白屏崩溃。
      const merged = mergeSettings(DEFAULT_SETTINGS, s as Partial<UnifiedSettings>)
      setSettings(merged)
      // M4 修复: 成功后清除错误态
      setLoadError(null)
    } catch (err) {
      console.error('[Settings] Failed to load:', err)
      // M4 修复: 记录失败原因供错误态展示(而非仅 toast 一闪而过)
      setLoadError(errText(err))
      toast.error(t('settings.load.failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = useCallback(
    async (path: string, value: unknown) => {
      try {
        setSaving(true)
        const result = await getAPI().settings.set(path, value)
        if (!result?.success) {
          toast.error(result?.error || `${t('settings.save.failed')}: ${path}`)
          return
        }
        setSettings((prev) => (prev ? deepSet(prev, path, value) : prev))
      } catch (err) {
        console.error('[Settings] Failed to save:', err)
        toast.error(`${t('settings.save.failed')}: ${path}`)
      } finally {
        setSaving(false)
      }
    },
    [t],
  )

  const handleReset = useCallback(async () => {
    resetConfirm.open()
  }, [resetConfirm])

  const executeReset = useCallback(async () => {
    try {
      setSaving(true)
      await getAPI().settings.reset()
      await loadSettings()
      toast.success(t('settings.reset.done'))
    } catch (err) {
      console.error('[Settings] Failed to reset:', err)
      toast.error(t('settings.reset.failed'))
    } finally {
      setSaving(false)
    }
  }, [loadSettings, t])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
        {t('common.loading')}
      </div>
    )
  }

  // M4 修复: 加载失败时显示错误态 + 重试按钮(此前永久停留"加载中"且无出口)
  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <EmptyState
          title={t('settings.load.failed')}
          description={loadError ?? undefined}
          action={
            <Button variant="primary" size="sm" onClick={() => loadSettings()}>
              {t('common.retry', '重试')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto animate-fade-in">
      <PageHeader
        title={t('settings.title')}
        size="md"
        actions={
          <div className="flex items-center gap-3">
            <select
              value={lang}
              onChange={(e) => {
                const newLang = e.target.value as 'zh' | 'en'
                import('../../i18n')
                  .then((m) => m.setLang(newLang))
                  .catch((err) => console.error('[Settings] i18n switch failed:', err))
                // 同步到 settings，保持 i18n 和 settings.general.language 一致
                const settingsLang = newLang === 'zh' ? 'zh-CN' : 'en-US'
                handleSave('general.language', settingsLang)
              }}
              className={cn(INPUT_BASE, 'px-1.5 py-0.5 text-[10px]')}
              title="UI Language"
              aria-label={t('page.settings.langSwitchAria', '切换界面语言')}
            >
              <option value="zh">{t('settings.language.zh', '中文')}</option>
              <option value="en">EN</option>
            </select>
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              aria-label={t('settings.reset')}
              className={cn(
                btnStyle('ghost'),
                'text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:border-red-500/50',
              )}
            >
              {t('settings.reset')}
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-5">
        {/* ===== 通用 ===== */}
        <GeneralSection settings={settings} onSave={handleSave} />
        <WebUiSection settings={settings} onSave={handleSave} />

        {/* ===== 对话 ===== */}
        <ChatSection settings={settings} onSave={handleSave} />

        {/* ===== MCP (education-advisor 特有 feature flag) ===== */}
        <McpSection settings={settings} onSave={handleSave} />

        {/* ===== 连接中心(消息频道,阶段 1 频道化) ===== */}
        <ChannelsSection settings={settings} onSave={handleSave} />

        {/* ===== 诊断 & 维护(状态自持) ===== */}
        <DiagnosticSection />

        {/* ===== 日志查看 ===== */}
        <LogSection />

        {/* ===== 数据与备份 ===== */}
        <MemorySection />
        <DataSection settings={settings} onSave={handleSave} />

        {/* ===== 关于 ===== */}
        <AboutSection />

        <ConfirmDialog
          open={resetConfirm.isOpen}
          title={t('settings.reset')}
          message={t('settings.reset.confirm')}
          onConfirm={async () => {
            resetConfirm.close()
            await executeReset()
          }}
          onCancel={resetConfirm.close}
        />
      </div>
    </div>
  )
}

// 深路径设置工具:set({a:{b:{c:1}}}, 'a.b.c', 2) => {a:{b:{c:2}}}
function deepSet<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.')
  const result: Record<string, unknown> = { ...(obj as Record<string, unknown>) }
  let current: Record<string, unknown> = result
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const next = (current[k] as Record<string, unknown>) ?? {}
    current[k] = { ...next }
    current = current[k] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
  return result as T
}
