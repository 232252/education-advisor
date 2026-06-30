// =============================================================
// 系统设置页面 (v4 整改:删除 StatusBadge 死代码)
//   - 所有字段均已实现 (live),不再需要状态徽章
//   - 保留 FIELD_HINT 提供鼠标悬停说明
//   - 保留 section: 通用 / 对话 / 飞书 / 诊断 / 日志 / 关于
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { setLang, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

// 字段提示信息（鼠标悬停显示）
// 所有字段已实现,不再需要 status 状态标识
const FIELD_HINT: Record<string, string> = {
  'general.dataDir': 'EAA 数据目录,首次启动自动生成',
  'general.language': 'i18n 已接入,useT hook 自动响应切换 (部分静态文案需重启)',
  'general.autoUpdate': '检查更新功能已接入',
  'general.autoStart': '同步写入系统登录项',
  'general.minimizeToTray': '托盘将实时创建/销毁',
  'general.logLevel': '主进程日志级别实现完毕,运行时即时生效',
  'chat.compaction.enabled': '上下文超长时自动压缩历史消息',
  'chat.compaction.reserveTokens': '压缩后保留的最小 token 数',
  'chat.compaction.keepRecentTokens': '压缩时强制保留的最近消息 token 数',
  'chat.steeringMode': 'Agent 运行时已读取并注入 system prompt',
  'chat.followUpMode': 'Agent 运行时已读取并注入 system prompt',
  'chat.showImages': 'ChatPage 已接入，设置后立即生效',
  'chat.maxTokens': 'pi-ai-service 已读取并传入 streamSimple',
  'feishu.appId': '飞书开放平台应用 ID',
  'feishu.appSecret': '已加密保存(keystore)',
  'feishu.userOpenId': '接收消息的用户 open_id',
  'feishu.bitableSync.enabled': 'cron-service.registerBitableSync 已接入',
  'feishu.bitableSync.syncInterval': '每 N 分钟一次',
  'eaa.doctor': 'EAA 引擎环境健康检查',
  'eaa.validate': 'EAA 事件数据完整性验证',
}

// 提示图标:有 hint 的字段显示一个小问号,鼠标悬停显示说明
function HintIcon({ path }: { path: string }) {
  const hint = FIELD_HINT[path]
  if (!hint) return null
  return (
    <span
      className="text-[10px] text-gray-400 dark:text-gray-500 cursor-help"
      title={hint}
      role="img"
      aria-label="提示"
    >
      ⓘ
    </span>
  )
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/80 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3.5 border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/40 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          role="img"
          aria-label="图标"
        >
          <title>图标</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y divide-gray-200 dark:divide-gray-700/60">{children}</div>}
    </div>
  )
}

function SettingRow({
  label,
  path,
  description,
  children,
}: {
  label: string
  path: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
          <HintIcon path={path} />
        </div>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function SecretInput({
  value,
  onChange,
  placeholder,
  onBlur,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onBlur?: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const display = value ? (revealed ? value : '••••••••') : ''
  return (
    <div className="flex items-center gap-1.5">
      <input
        type={revealed ? 'text' : 'password'}
        value={display}
        placeholder={placeholder ?? '未设置'}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-44 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 transition-colors"
        >
          {revealed ? '隐藏' : '显示'}
        </button>
      )}
    </div>
  )
}

export function SettingsPage() {
  const { t, lang } = useT()
  const [settings, setSettings] = useState<UnifiedSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [logFiles, setLogFiles] = useState<
    Array<{ stream: string; date: string; name: string; sizeBytes: number }>
  >([])
  const [logContent, setLogContent] = useState('')
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [feishuTestStatus, setFeishuTestStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle')
  const [feishuTestInfo, setFeishuTestInfo] = useState<string>('')
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
  // H-9 修复: 日志搜索防抖 timer ref,避免每次按键都触发 IPC 搜索
  const logSearchTimerRef = useRef<NodeJS.Timeout | null>(null)
  // MEDIUM 修复: 组件卸载时清理 logSearchTimerRef,防止内存泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      if (logSearchTimerRef.current) {
        clearTimeout(logSearchTimerRef.current)
        logSearchTimerRef.current = null
      }
    }
  }, [])
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
  const [pendingConfirm, setPendingConfirm] = useState<'reset' | 'clearLogs' | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const s = await getAPI().settings.get()
      setSettings(s)
      // C-4 修复: 从 settings 加载 bitableAppToken 到本地 state
      // 之前该字段只在本地 state,从未持久化,重启后丢失
      setBitableAppToken(s.feishu?.bitableAppToken ?? '')
    } catch (err) {
      console.error('[Settings] Failed to load:', err)
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
    setPendingConfirm('reset')
  }, [])

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

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
            {t('settings.title')}
          </h1>
          <select
            value={lang}
            onChange={(e) => {
              const newLang = e.target.value as 'zh' | 'en'
              import('../../i18n').then((m) => m.setLang(newLang))
              // 同步到 settings，保持 i18n 和 settings.general.language 一致
              const settingsLang = newLang === 'zh' ? 'zh-CN' : 'en-US'
              handleSave('general.language', settingsLang)
            }}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-400"
            title="UI Language"
          >
            <option value="zh">中文</option>
            <option value="en">EN</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 border border-gray-300 dark:border-gray-600 hover:border-rose-500/50 dark:hover:border-rose-500/50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {t('settings.reset')}
        </button>
      </div>

      {/* ===== 通用 ===== */}
      <Section title={t('settings.section.general')}>
        <SettingRow
          label="主题"
          path="general.theme"
          description="界面外观,system 表示跟随操作系统"
        >
          <select
            value={settings.general.theme}
            onChange={(e) => {
              const v = e.target.value
              handleSave('general.theme', v)
              // 通知 useTheme hook 立即应用新主题
              window.dispatchEvent(new CustomEvent('theme-changed', { detail: v }))
            }}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="dark">{t('settings.theme.dark')}</option>
            <option value="light">{t('settings.theme.light')}</option>
            <option value="system">{t('settings.theme.system')}</option>
          </select>
        </SettingRow>

        <SettingRow
          label="语言"
          path="general.language"
          description="界面语言,useT hook 自动响应切换 (部分静态文案需重启)"
        >
          <select
            value={settings.general.language}
            onChange={(e) => {
              const v = e.target.value
              handleSave('general.language', v)
              // 同步触发 i18n 切换（settings 值 zh-CN/en-US → i18n 值 zh/en）
              setLang(v === 'zh-CN' ? 'zh' : 'en')
            }}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </SettingRow>

        <SettingRow label="数据目录" path="general.dataDir" description={settings.general.dataDir}>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {settings.general.dataDir || '—'}
          </span>
        </SettingRow>

        <SettingRow
          label="开机启动"
          path="general.autoStart"
          description="操作系统启动时自动运行 Education Advisor"
        >
          <ToggleSwitch
            checked={settings.general.autoStart}
            onChange={(v) => handleSave('general.autoStart', v)}
          />
        </SettingRow>

        <SettingRow
          label="最小化到托盘"
          path="general.minimizeToTray"
          description="关闭窗口时最小化到系统托盘,不退出"
        >
          <ToggleSwitch
            checked={settings.general.minimizeToTray}
            onChange={(v) => handleSave('general.minimizeToTray', v)}
          />
        </SettingRow>

        <SettingRow
          label="关闭按钮行为"
          path="general.closeBehavior"
          description="点击窗口右上角关闭按钮时如何处理"
        >
          <select
            value={settings.general.closeBehavior}
            onChange={(e) => handleSave('general.closeBehavior', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="ask">每次询问</option>
            <option value="tray">最小化到托盘</option>
            <option value="exit">退出应用</option>
          </select>
        </SettingRow>

        <SettingRow
          label="日志级别"
          path="general.logLevel"
          description="控制主进程和渲染进程的日志输出详细程度(5 档)"
        >
          <select
            value={settings.general.logLevel}
            onChange={(e) => handleSave('general.logLevel', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="debug">Debug (全日志)</option>
            <option value="info">Info (重要事件)</option>
            <option value="warn">Warn (警告)</option>
            <option value="error">Error (仅错误)</option>
            <option value="off">Off (关闭)</option>
          </select>
        </SettingRow>

        <SettingRow label="自动更新" path="general.autoUpdate" description="启动时自动检查新版本">
          <ToggleSwitch
            checked={settings.general.autoUpdate}
            onChange={(v) => handleSave('general.autoUpdate', v)}
          />
        </SettingRow>

        <SettingRow
          label="更新源"
          path="general.updateUrl"
          description="GitHub 仓库地址，用于检查更新（如 https://github.com/owner/repo）"
        >
          <input
            type="text"
            value={settings.general.updateUrl}
            placeholder="https://github.com/owner/repo"
            onChange={(e) => handleSave('general.updateUrl', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-56 focus:border-blue-500 outline-none transition-colors"
          />
        </SettingRow>

        <SettingRow
          label="检查更新"
          path="general.checkUpdate"
          description="手动检查是否有新版本可用"
        >
          <button
            type="button"
            onClick={async () => {
              // H-6 修复: 加 try/catch,避免检查更新失败时无反馈
              try {
                const result = await getAPI().sys.checkUpdate()
                if (result.hasUpdate) {
                  await getAPI().sys.showUpdateDialog()
                } else {
                  toast.success(result.message || `已是最新版本 v${result.currentVersion}`)
                }
              } catch (err) {
                console.error('[Settings] checkUpdate failed:', err)
                toast.error('检查更新失败,请查看日志')
              }
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
          >
            检查更新
          </button>
        </SettingRow>
      </Section>

      {/* ===== 对话 ===== */}
      <Section title={t('settings.section.chat')}>
        <SettingRow
          label="最大 Token 数"
          path="chat.maxTokens"
          description="单次对话上下文窗口大小,数值越大支持的上下文越长"
        >
          <input
            type="number"
            min={512}
            max={200000}
            step={512}
            value={settings.chat.maxTokens}
            onChange={(e) => handleSave('chat.maxTokens', Number(e.target.value))}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-28 focus:border-blue-500 outline-none transition-colors"
          />
        </SettingRow>

        <SettingRow
          label="自动压缩对话"
          path="chat.compaction.enabled"
          description="上下文超长时自动压缩历史消息"
        >
          <ToggleSwitch
            checked={settings.chat.compaction.enabled}
            onChange={(v) => handleSave('chat.compaction.enabled', v)}
          />
        </SettingRow>

        <SettingRow
          label="压缩保留 Token"
          path="chat.compaction.reserveTokens"
          description="压缩后保留的最小上下文 token 数"
        >
          <input
            type="number"
            min={256}
            max={32000}
            step={256}
            value={settings.chat.compaction.reserveTokens}
            onChange={(e) => handleSave('chat.compaction.reserveTokens', Number(e.target.value))}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-28 focus:border-blue-500 outline-none transition-colors"
            disabled={!settings.chat.compaction.enabled}
          />
        </SettingRow>

        <SettingRow
          label="保留最近 Token"
          path="chat.compaction.keepRecentTokens"
          description="压缩时强制保留的最近消息 token 数"
        >
          <input
            type="number"
            min={256}
            max={32000}
            step={256}
            value={settings.chat.compaction.keepRecentTokens}
            onChange={(e) => handleSave('chat.compaction.keepRecentTokens', Number(e.target.value))}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-28 focus:border-blue-500 outline-none transition-colors"
            disabled={!settings.chat.compaction.enabled}
          />
        </SettingRow>

        <SettingRow
          label="引导模式"
          path="chat.steeringMode"
          description="Agent 接受用户中途引导(steering)的方式"
        >
          <select
            value={settings.chat.steeringMode}
            onChange={(e) => handleSave('chat.steeringMode', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="all">全部</option>
            <option value="one-at-a-time">一次一个</option>
          </select>
        </SettingRow>

        <SettingRow
          label="追问模式"
          path="chat.followUpMode"
          description="Agent 回答后追问用户的方式"
        >
          <select
            value={settings.chat.followUpMode}
            onChange={(e) => handleSave('chat.followUpMode', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="all">全部</option>
            <option value="one-at-a-time">一次一个</option>
          </select>
        </SettingRow>

        <SettingRow
          label="显示图片"
          path="chat.showImages"
          description="在对话中渲染 Markdown 图片"
        >
          <ToggleSwitch
            checked={settings.chat.showImages}
            onChange={(v) => handleSave('chat.showImages', v)}
          />
        </SettingRow>

        <SettingRow
          label="对话日志记录"
          path="chat.conversationLogging"
          description="全量记录聊天流事件到 logs/chat-YYYY-MM-DD.log,含 in/out/event 三个方向"
        >
          <ToggleSwitch
            checked={settings.chat.conversationLogging}
            onChange={(v) => handleSave('chat.conversationLogging', v)}
          />
        </SettingRow>
      </Section>

      {/* ===== 飞书 ===== */}
      <Section title={t('settings.section.feishu')}>
        <SettingRow label="App ID" path="feishu.appId" description="飞书开放平台应用 ID (cli_xxxx)">
          <input
            type="text"
            value={settings.feishu.appId}
            placeholder="cli_xxxxxxxx"
            onChange={(e) => handleSave('feishu.appId', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-48 focus:border-blue-500 outline-none transition-colors"
          />
        </SettingRow>

        <SettingRow
          label="App Secret"
          path="feishu.appSecret"
          description="飞书应用密钥,已加密保存到 keystore"
        >
          <div className="flex items-center gap-2">
            <SecretInput
              value={settings.feishu.appSecret}
              onChange={(v) => handleSave('feishu.appSecret', v)}
            />
            <button
              type="button"
              onClick={async () => {
                if (!settings.feishu.appId) {
                  setFeishuTestStatus('error')
                  setFeishuTestInfo('请先填写 App ID')
                  return
                }
                setFeishuTestStatus('testing')
                setFeishuTestInfo('正在测试...')
                // appSecret 从 keystore 读取，不再通过参数传递
                const result = await getAPI().feishu.test(settings.feishu.appId)
                if (result.success) {
                  setFeishuTestStatus('success')
                  setFeishuTestInfo(`连接成功 · token=${result.token} · 过期 ${result.expireSec}s`)
                } else {
                  setFeishuTestStatus('error')
                  setFeishuTestInfo(`连接失败 · ${result.error}`)
                }
              }}
              disabled={feishuTestStatus === 'testing'}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {feishuTestStatus === 'testing' ? '测试中...' : '测试连接'}
            </button>
          </div>
          {feishuTestInfo && (
            <div
              className={`text-[10px] mt-1 ${
                feishuTestStatus === 'success'
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : feishuTestStatus === 'error'
                    ? 'text-rose-500 dark:text-rose-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {feishuTestInfo}
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="用户 Open ID"
          path="feishu.userOpenId"
          description="接收消息的目标用户 open_id (ou_xxxx)"
        >
          <input
            type="text"
            value={settings.feishu.userOpenId}
            placeholder="ou_xxxxxxxx"
            onChange={(e) => handleSave('feishu.userOpenId', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-48 focus:border-blue-500 outline-none transition-colors"
          />
        </SettingRow>

        <SettingRow
          label="Bitable App Token"
          path="feishu.bitableAppToken"
          description="飞书多维表格的 app_token(在 bitable URL 中可找到)"
        >
          <input
            type="text"
            value={bitableAppToken}
            placeholder="bascnXXXXXXXXXX"
            onChange={(e) => {
              const v = e.target.value
              setBitableAppToken(v)
              // C-4 修复: 同步持久化到 settings,之前只更新本地 state 导致重启丢失
              handleSave('feishu.bitableAppToken', v)
            }}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-48 focus:border-blue-500 outline-none transition-colors"
          />
        </SettingRow>

        <SettingRow
          label="Bitable 列表"
          path="feishu.bitableList"
          description="点击拉取 Bitable 下所有表,验证凭证有效性"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!settings.feishu.appId || !bitableAppToken) {
                  setBitableListInfo('请先填写 App ID 和 Bitable App Token')
                  return
                }
                setBitableListInfo('正在拉取...')
                dispatchBitList({ type: 'LIST' })
                const result = await getAPI().feishu.listBitable(
                  settings.feishu.appId,
                  bitableAppToken,
                )
                if (result.success && result.tables) {
                  dispatchBitList({ type: 'SUCCESS' })
                  setBitableListInfo(
                    `找到 ${result.tables.length} 个表: ${result.tables.map((t) => t.name).join(', ')}`,
                  )
                } else {
                  dispatchBitList({ type: 'ERROR' })
                  setBitableListInfo(`拉取失败 · ${result.error || '未知错误'}`)
                }
              }}
              disabled={bitableListStatus === 'listing'}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {bitableListStatus === 'listing' ? '拉取中...' : '拉取列表'}
            </button>
          </div>
          {bitableListInfo && (
            <div
              className={`text-[10px] mt-1 ${
                bitableListStatus === 'success'
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : bitableListStatus === 'error'
                    ? 'text-rose-500 dark:text-rose-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {bitableListInfo}
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="Bitable 同步"
          path="feishu.bitableSync.enabled"
          description="定时把 AI 报告同步到飞书多维表格"
        >
          <ToggleSwitch
            checked={settings.feishu.bitableSync.enabled}
            onChange={(v) => handleSave('feishu.bitableSync.enabled', v)}
          />
        </SettingRow>

        <SettingRow
          label="同步间隔"
          path="feishu.bitableSync.syncInterval"
          description="自动同步的时间间隔，支持 cron 表达式（如 0 */6 * * *）或分钟数"
        >
          <input
            type="text"
            value={settings.feishu.bitableSync.syncInterval}
            placeholder="0 */6 * * *"
            onChange={(e) => handleSave('feishu.bitableSync.syncInterval', e.target.value)}
            className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 w-40 focus:border-blue-500 outline-none transition-colors"
            disabled={!settings.feishu.bitableSync.enabled}
          />
        </SettingRow>
      </Section>

      {/* ===== 诊断 & 维护 ===== */}
      <Section title="诊断 & 维护">
        <SettingRow
          label="EAA 健康检查"
          path="eaa.doctor"
          description="检查 EAA 引擎运行环境、数据完整性、配置正确性"
        >
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={async () => {
                setDoctorStatus('running')
                setDoctorResult(null)
                try {
                  const result = await getAPI().eaa.doctor()
                  if (result.success && result.data) {
                    setDoctorResult(
                      result.data as {
                        healthy: boolean
                        passed: number
                        failed: number
                        issues: string[]
                      },
                    )
                  } else {
                    setDoctorResult({
                      healthy: false,
                      passed: 0,
                      failed: 0,
                      issues: [(result as { stderr?: string }).stderr || '未知错误'],
                    })
                  }
                } catch (err) {
                  setDoctorResult({ healthy: false, passed: 0, failed: 0, issues: [String(err)] })
                } finally {
                  setDoctorStatus('done')
                }
              }}
              disabled={doctorStatus === 'running'}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {doctorStatus === 'running' ? '检查中...' : '运行检查'}
            </button>
            {doctorResult && (
              <div className="text-[10px] leading-relaxed">
                {doctorResult.healthy ? (
                  <span className="text-emerald-500 dark:text-emerald-400">✓ 健康</span>
                ) : (
                  <span className="text-rose-500 dark:text-rose-400">✗ 异常</span>
                )}
                <span className="text-gray-500 dark:text-gray-400 ml-2">
                  通过 {doctorResult.passed} / 失败 {doctorResult.failed}
                </span>
                {doctorResult.issues.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-rose-500 dark:text-rose-400">
                    {doctorResult.issues.map((issue) => (
                      <li key={issue}>• {issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="数据完整性验证"
          path="eaa.validate"
          description="验证所有事件数据的完整性和一致性"
        >
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={async () => {
                setValidateStatus('running')
                setValidateResult(null)
                try {
                  const result = await getAPI().eaa.validate()
                  if (result.success && result.data) {
                    setValidateResult(
                      result.data as {
                        valid: boolean
                        total_events: number
                        errors: string[]
                        warnings: string[]
                      },
                    )
                  } else {
                    setValidateResult({
                      valid: false,
                      total_events: 0,
                      errors: ['验证失败'],
                      warnings: [],
                    })
                  }
                } catch (err) {
                  setValidateResult({
                    valid: false,
                    total_events: 0,
                    errors: [String(err)],
                    warnings: [],
                  })
                } finally {
                  setValidateStatus('done')
                }
              }}
              disabled={validateStatus === 'running'}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {validateStatus === 'running' ? '验证中...' : '验证'}
            </button>
            {validateResult && (
              <div className="text-[10px] leading-relaxed">
                {validateResult.valid ? (
                  <span className="text-emerald-500 dark:text-emerald-400">✓ 数据完整</span>
                ) : (
                  <span className="text-rose-500 dark:text-rose-400">✗ 发现问题</span>
                )}
                <span className="text-gray-500 dark:text-gray-400 ml-2">
                  共 {validateResult.total_events} 条事件
                  {validateResult.errors.length > 0 && (
                    <span className="text-rose-500 dark:text-rose-400 ml-1">
                      错误 {validateResult.errors.length}
                    </span>
                  )}
                  {validateResult.warnings.length > 0 && (
                    <span className="text-amber-500 dark:text-amber-400 ml-1">
                      警告 {validateResult.warnings.length}
                    </span>
                  )}
                </span>
                {validateResult.errors.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-rose-500 dark:text-rose-400">
                    {validateResult.errors.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                )}
                {validateResult.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-amber-500 dark:text-amber-400">
                    {validateResult.warnings.map((w) => (
                      <li key={w}>• {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </SettingRow>
      </Section>

      {/* ===== 日志查看 ===== */}
      <Section title="日志查看">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              实时查看 logs/ 目录下的 main / chat / renderer 三类日志,按日期分割
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  // H-6 修复: 加 try/catch,避免 IPC 失败时按钮无反馈
                  try {
                    const list = await getAPI().log.list()
                    setLogFiles(list)
                  } catch (err) {
                    console.error('[Settings] log.list failed:', err)
                    toast.error('刷新日志列表失败')
                  }
                }}
                className="text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
              >
                刷新列表
              </button>
              <button
                type="button"
                onClick={() => setPendingConfirm('clearLogs')}
                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
              >
                清空
              </button>
            </div>
          </div>

          {/* T3: 增强工具栏 — level 过滤 + 搜索 + 导出 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">级别:</span>
              <select
                value={logLevelFilter}
                onChange={async (e) => {
                  const v = e.target.value
                  setLogLevelFilter(v)
                  if (selectedLog) {
                    const levels = v === 'all' ? [] : [v]
                    const content =
                      levels.length === 0
                        ? await getAPI().log.read(selectedLog, 200)
                        : await getAPI().log.filter(selectedLog, levels, 200)
                    setLogContent(content)
                  }
                }}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-1.5 py-1 text-[10px] text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
              >
                <option value="all">全部</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>

            <input
              type="text"
              value={logSearchQuery}
              placeholder="搜索日志内容..."
              onChange={(e) => {
                const v = e.target.value
                setLogSearchQuery(v)
                // H-9 修复: 300ms 防抖,避免每次按键都触发 IPC 搜索导致卡顿
                if (logSearchTimerRef.current) {
                  clearTimeout(logSearchTimerRef.current)
                }
                logSearchTimerRef.current = setTimeout(async () => {
                  logSearchTimerRef.current = null
                  if (selectedLog) {
                    try {
                      const content = v.trim()
                        ? await getAPI().log.search(selectedLog, v, 200)
                        : logLevelFilter === 'all'
                          ? await getAPI().log.read(selectedLog, 200)
                          : await getAPI().log.filter(selectedLog, [logLevelFilter], 200)
                      setLogContent(content)
                    } catch (err) {
                      console.warn('[Settings] log search failed:', err)
                    }
                  }
                }, 300)
              }}
              className="flex-1 min-w-[120px] bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1 text-[10px] text-gray-700 dark:text-gray-200 focus:border-blue-500 outline-none transition-colors"
            />

            <button
              type="button"
              onClick={async () => {
                if (!selectedLog) {
                  toast.warning('请先选择一个日志文件')
                  return
                }
                // H-6 修复: 加 try/catch,避免导出失败时无反馈
                try {
                  const result = await getAPI().log.exportWithDialog(selectedLog)
                  if (result.canceled) return
                  if (result.bytes > 0) {
                    toast.success(`已导出 ${result.bytes} 字节到 ${result.path}`)
                  } else {
                    toast.warning('导出文件为空或失败')
                  }
                } catch (err) {
                  console.error('[Settings] log export failed:', err)
                  toast.error('导出日志失败')
                }
              }}
              disabled={!selectedLog}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              导出
            </button>
          </div>

          {logFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {logFiles.map((f) => (
                <button
                  type="button"
                  key={f.name}
                  onClick={async () => {
                    // H-6 修复: 加 try/catch,避免读取日志失败时无反馈
                    setSelectedLog(f.name)
                    try {
                      const content = logSearchQuery.trim()
                        ? await getAPI().log.search(f.name, logSearchQuery, 200)
                        : logLevelFilter === 'all'
                          ? await getAPI().log.read(f.name, 200)
                          : await getAPI().log.filter(f.name, [logLevelFilter], 200)
                      setLogContent(content)
                    } catch (err) {
                      console.error('[Settings] log read failed:', err)
                      setLogContent('读取日志失败,请查看控制台')
                    }
                  }}
                  className={`text-[10px] px-2 py-1 rounded-lg border ${
                    selectedLog === f.name
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-600 dark:text-blue-200'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/30'
                  }`}
                >
                  {f.stream}/{f.date} ({Math.round(f.sizeBytes / 1024)}KB)
                </button>
              ))}
            </div>
          )}

          {logContent && (
            <pre className="bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/80 rounded-lg p-3 text-[10px] text-gray-700 dark:text-gray-300 max-h-64 overflow-y-auto font-mono whitespace-pre-wrap leading-relaxed">
              {logContent}
            </pre>
          )}

          {logFiles.length === 0 && !logContent && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">
              尚无日志文件。App 启动并产生日志后会出现在此。
            </div>
          )}
        </div>
      </Section>

      {/* ===== 关于 ===== */}
      <Section title={t('settings.section.about')}>
        <div className="px-5 py-5 space-y-4">
          <div>
            <div className="text-base text-gray-800 dark:text-gray-100 font-semibold">
              Education Advisor{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">v0.1.0</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              Education Advisor — Pi Agent + Education Advisor AI
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
                底层核心
              </div>
              <div className="space-y-1.5 text-xs">
                <div>
                  <span className="text-blue-500 dark:text-blue-400 font-medium">EAA Core</span>
                  <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                    {' '}
                    — Rust 操行评分/事件/隐私引擎, 22 子命令
                  </span>
                </div>
                <div>
                  <span className="text-blue-500 dark:text-blue-400 font-medium">
                    17 教育 Agent
                  </span>
                  <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                    {' '}
                    — 参谋/督导/辅导员/心理/纪律/班务等多智能体
                  </span>
                </div>
                <div>
                  <a
                    href="https://github.com/earendil-works/pi"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                  >
                    Pi Agent
                  </a>
                  <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                    {' '}
                    — Agent 运行时 (packages/agent)
                  </span>
                </div>
                <div>
                  <a
                    href="https://github.com/earendil-works/pi"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                  >
                    Pi-AI
                  </a>
                  <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                    {' '}
                    — LLM 通信层 (packages/ai)
                  </span>
                </div>
                <div>
                  <span className="text-blue-500 dark:text-blue-400 font-medium">PII Shield</span>
                  <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                    {' '}
                    — 隐私脱敏加密引擎
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
                关键依赖
              </div>
              <div className="grid grid-cols-1 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                <span>Electron 33.2 + React 18.3</span>
                <span>TypeScript 5.7 + Vite 6</span>
                <span>Tailwind 3 + Zustand 5</span>
                <span>better-sqlite3 + TypeBox</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Education Advisor 内置 EAA Core (Rust) + Pi Agent 运行时 + Pi-AI 通信层 + 17 个教育 AI
            Agent，遵循 MIT 协议发布。
          </p>

          <div className="pt-3 border-t border-gray-200 dark:border-gray-700/60">
            <div className="text-[10px] text-gray-400 dark:text-gray-500 italic leading-relaxed">
              本设置页面在 T1 (2026-06-05) 经过整改 — 删除了 5
              个无价值模块(模型/隐私/高级/快捷键/匿名上报)与顶部组织说明文字, 保留通用/对话/飞书 3
              个核心 section。新增「关于」模块展示开源信息。
            </div>
          </div>
        </div>
      </Section>
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm === 'reset' ? t('settings.reset') : '清空日志'}
        message={pendingConfirm === 'reset' ? t('settings.reset.confirm') : '清空所有日志文件?'}
        variant={pendingConfirm === 'clearLogs' ? 'danger' : 'default'}
        onConfirm={async () => {
          const action = pendingConfirm
          setPendingConfirm(null)
          if (action === 'reset') {
            await executeReset()
          } else if (action === 'clearLogs') {
            try {
              await getAPI().log.clear()
              setLogFiles([])
              setLogContent('')
              setSelectedLog('')
              setLogSearchQuery('')
              setLogLevelFilter('all')
              toast.success('已清空所有日志')
            } catch (err) {
              console.error('[Settings] log.clear failed:', err)
              toast.error('清空日志失败')
            }
          }
        }}
        onCancel={() => setPendingConfirm(null)}
      />
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
