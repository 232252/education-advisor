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

import type { FeishuBotStatusInfo, UnifiedSettings } from '@shared/types'
import { useCallback, useEffect, useReducer, useState } from 'react'
import DEFAULT_SETTINGS_JSON from '../../../../config/default-settings.json'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import {
  AboutSection,
  ChatSection,
  DataSection,
  DiagnosticSection,
  FeishuSection,
  GeneralSection,
  LogSection,
  McpSection,
} from './sections'

/**
 * 深合并:以后端 settings 覆盖默认 settings 的对应层,确保所有嵌套字段存在。
 * 防止 settings.feishu.bitableSync 这类访问因字段缺失而崩溃(UI-1 修复)。
 * 浅层合并只 merge 一层不够,要递归到对象叶子。
 *
 * 边界处理:
 *  - defaults/partial 为 null/undefined 时走空对象兜底,避免递归崩溃
 *  - 仅在两边都是 plain object(非数组)时递归,数组按值覆盖
 *  - partial 中 key 为 undefined 时保留 defaults 原值,只有有效值才覆盖
 */
function mergeSettings(
  defaults: Partial<UnifiedSettings> | null | undefined,
  partial: Partial<UnifiedSettings> | null | undefined,
): UnifiedSettings {
  const safeDefaults: Record<string, unknown> = (defaults ?? {}) as Record<string, unknown>
  const safePartial: Record<string, unknown> = (partial ?? {}) as Record<string, unknown>
  const result: Record<string, unknown> = { ...safeDefaults }
  for (const key of Object.keys(safePartial)) {
    const dVal = safeDefaults[key]
    const pVal = safePartial[key]
    if (pVal === undefined) continue
    const dIsObj = dVal !== null && typeof dVal === 'object' && !Array.isArray(dVal)
    const pIsObj = pVal !== null && typeof pVal === 'object' && !Array.isArray(pVal)
    if (dIsObj && pIsObj) {
      // 两边都是对象:递归合并,确保所有默认叶子字段都保留
      result[key] = mergeSettings(
        dVal as Partial<UnifiedSettings>,
        pVal as Partial<UnifiedSettings>,
      )
    } else {
      // 否则(primitive / array / null):用 partial 覆盖
      result[key] = pVal
    }
  }
  return result as unknown as UnifiedSettings
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
  const [logFiles, setLogFiles] = useState<
    Array<{ stream: string; date: string; name: string; sizeBytes: number }>
  >([])
  const [logContent, setLogContent] = useState('')
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [feishuTestStatus, setFeishuTestStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle')
  const [feishuTestInfo, setFeishuTestInfo] = useState<string>('')
  // 飞书长连接机器人状态(设置页徽章实时显示)
  const [botStatus, setBotStatus] = useState<FeishuBotStatusInfo | null>(null)
  useEffect(() => {
    // 挂载时拉取一次当前状态,并订阅后续变化
    getAPI()
      .feishu.botStatus()
      .then(setBotStatus)
      .catch((err) => console.warn('[SettingsPage] feishu botStatus initial fetch failed:', err))
    const unsub = getAPI().feishu.onBotStatusUpdate((info) => setBotStatus(info))
    return unsub
  }, [])
  // T2: Bitable 列表 (T4 改用 useReducer 规避 React 19 setter 推断问题)
  const [bitableAppToken, setBitableAppToken] = useState<string>('')
  type BitListStatus = 'idle' | 'listing' | 'success' | 'error'
  type BitListAction =
    | { type: 'LIST' }
    | { type: 'SUCCESS' }
    | { type: 'ERROR' }
    | { type: 'RESET' }
  const [bitableListStatus, dispatchBitList] = useReducer(
    (state: BitListStatus, action: BitListAction): BitListStatus => {
      if (action.type === 'LIST' && state === 'idle') return 'listing'
      if (action.type === 'SUCCESS' && state === 'listing') return 'success'
      if (action.type === 'ERROR' && (state === 'idle' || state === 'listing')) return 'error'
      if (action.type === 'RESET') return 'idle'
      return state
    },
    'idle',
  )
  const [bitableListInfo, setBitableListInfo] = useState<string>('')
  // T3: viewer UI 增强
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all')
  const [logSearchQuery, setLogSearchQuery] = useState<string>('')
  // 日志搜索防抖已下沉到 LogSection,通过 useDebouncedCallback hook 内部管理 timer 生命周期
  // 诊断 & 维护
  const [doctorStatus, setDoctorStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [doctorResult, setDoctorResult] = useState<{
    healthy: boolean
    passed: number
    failed: number
    issues: string[]
  } | null>(null)
  const [validateStatus, setValidateStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [validateResult, setValidateResult] = useState<{
    valid: boolean
    total_events: number
    errors: string[]
    warnings: string[]
  } | null>(null)
  // 接入 useConfirmDialog: 两个独立 dialog 替代原先手写的
  // useState<'reset' | 'clearLogs' | null> 共用一个 ConfirmDialog 的判别联合模式
  const resetConfirm = useConfirmDialog<void>()
  const clearLogsConfirm = useConfirmDialog<void>()

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const s = await getAPI().settings.get()
      // UI-1 修复: 深合并默认值,防止嵌套字段(如 feishu.bitableSync / chat.compaction /
      // general.theme / mcp 等)在后端迁移/升级后缺失,导致 settings.feishu.bitableSync.enabled
      // 等嵌套访问触发 "Cannot read properties of undefined" 而白屏崩溃。
      const merged = mergeSettings(DEFAULT_SETTINGS, s as Partial<UnifiedSettings>)
      setSettings(merged)
      // C-4 修复: 从 settings 加载 bitableAppToken 到本地 state
      // 之前该字段只在本地 state,从未持久化,重启后丢失
      setBitableAppToken(merged.feishu?.bitableAppToken ?? '')
      // M4 修复: 成功后清除错误态
      setLoadError(null)
    } catch (err) {
      console.error('[Settings] Failed to load:', err)
      // M4 修复: 记录失败原因供错误态展示(而非仅 toast 一闪而过)
      setLoadError(err instanceof Error ? err.message : String(err))
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
        await getAPI().settings.set(path, value)
        setSettings((prev) => (prev ? { ...prev, ...deepSet(prev, path, value) } : prev))
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
                'text-xs text-gray-500 dark:text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 hover:border-rose-500/50',
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

        {/* ===== 对话 ===== */}
        <ChatSection settings={settings} onSave={handleSave} />

        {/* ===== MCP (education-advisor 特有 feature flag) ===== */}
        <McpSection settings={settings} onSave={handleSave} />

        {/* ===== 飞书 ===== */}
        <FeishuSection
          settings={settings}
          onSave={handleSave}
          botStatus={botStatus}
          feishuTestStatus={feishuTestStatus}
          feishuTestInfo={feishuTestInfo}
          setFeishuTestStatus={setFeishuTestStatus}
          setFeishuTestInfo={setFeishuTestInfo}
          bitableAppToken={bitableAppToken}
          setBitableAppToken={setBitableAppToken}
          bitableListStatus={bitableListStatus}
          dispatchBitList={dispatchBitList}
          bitableListInfo={bitableListInfo}
          setBitableListInfo={setBitableListInfo}
        />

        {/* ===== 诊断 & 维护 ===== */}
        <DiagnosticSection
          doctorStatus={doctorStatus}
          doctorResult={doctorResult}
          setDoctorStatus={setDoctorStatus}
          setDoctorResult={setDoctorResult}
          validateStatus={validateStatus}
          validateResult={validateResult}
          setValidateStatus={setValidateStatus}
          setValidateResult={setValidateResult}
        />

        {/* ===== 日志查看 ===== */}
        <LogSection
          logFiles={logFiles}
          logContent={logContent}
          selectedLog={selectedLog}
          logLevelFilter={logLevelFilter}
          logSearchQuery={logSearchQuery}
          setLogFiles={setLogFiles}
          setLogContent={setLogContent}
          setSelectedLog={setSelectedLog}
          setLogLevelFilter={setLogLevelFilter}
          setLogSearchQuery={setLogSearchQuery}
          onClearLogsRequest={() => clearLogsConfirm.open()}
        />

        {/* ===== 数据与备份 ===== */}
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
        <ConfirmDialog
          open={clearLogsConfirm.isOpen}
          title={t('page.settings.logs.clearTitle', '清空日志')}
          message={t('settings.logs.clear.confirm', '清空所有日志文件?')}
          variant="danger"
          onConfirm={async () => {
            clearLogsConfirm.close()
            try {
              await getAPI().log.clear()
              setLogFiles([])
              setLogContent('')
              setSelectedLog('')
              setLogSearchQuery('')
              setLogLevelFilter('all')
              toast.success(t('toast.settings.logsCleared'))
            } catch (err) {
              console.error('[Settings] log.clear failed:', err)
              toast.error(t('toast.settings.clearLogsFailed'))
            }
          }}
          onCancel={clearLogsConfirm.close}
        />
      </div>
    </div>
  )
}

// 深路径设置工具:set({a:{b:{c:1}}}, 'a.b.c', 2) => {a:{b:{c:2}}}
function deepSet(obj: object, path: string, value: unknown): object {
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
  return result
}
