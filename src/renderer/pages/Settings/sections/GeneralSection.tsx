// =============================================================
// 通用设置 Section — 主题/语言/数据目录/开机启动/托盘/日志级别/更新
// SettingRow: theme / language / dataDir / autoStart / minimizeToTray
//             / closeBehavior / logLevel / autoUpdate / updateUrl / checkUpdate
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { setLang, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { Section, SettingRow, ToggleSwitch } from '../components'

export interface GeneralSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function GeneralSection({ settings, onSave }: GeneralSectionProps) {
  const { t } = useT()

  return (
    <Section title={t('settings.section.general')}>
      <SettingRow label="主题" path="general.theme" description="界面外观,system 表示跟随操作系统">
        <select
          value={settings.general.theme}
          onChange={(e) => {
            const v = e.target.value
            onSave('general.theme', v)
            // 通知 useTheme hook 立即应用新主题
            window.dispatchEvent(new CustomEvent('theme-changed', { detail: v }))
          }}
          className={INPUT_SM}
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
            onSave('general.language', v)
            // 同步触发 i18n 切换（settings 值 zh-CN/en-US → i18n 值 zh/en）
            setLang(v === 'zh-CN' ? 'zh' : 'en')
          }}
          className={INPUT_SM}
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
        label="时区"
        path="general.timezone"
        description="cron 定时任务的调度时区,影响每日重置/定时报告的触发时间"
      >
        <select
          value={settings.general.timezone}
          onChange={(e) => onSave('general.timezone', e.target.value)}
          className={INPUT_SM}
        >
          <option value="Asia/Shanghai">亚洲/上海 (UTC+8)</option>
          <option value="Asia/Tokyo">亚洲/东京 (UTC+9)</option>
          <option value="Asia/Singapore">亚洲/新加坡 (UTC+8)</option>
          <option value="America/Los_Angeles">美洲/洛杉矶 (UTC-8)</option>
          <option value="America/New_York">美洲/纽约 (UTC-5)</option>
          <option value="Europe/London">欧洲/伦敦 (UTC+0)</option>
          <option value="UTC">UTC</option>
        </select>
      </SettingRow>

      <SettingRow
        label="开机启动"
        path="general.autoStart"
        description="操作系统启动时自动运行 Education Advisor"
      >
        <ToggleSwitch
          checked={settings.general.autoStart}
          onChange={(v) => onSave('general.autoStart', v)}
          label="开机启动"
        />
      </SettingRow>

      <SettingRow
        label="最小化到托盘"
        path="general.minimizeToTray"
        description="关闭窗口时最小化到系统托盘,不退出"
      >
        <ToggleSwitch
          checked={settings.general.minimizeToTray}
          onChange={(v) => onSave('general.minimizeToTray', v)}
          label="最小化到托盘"
        />
      </SettingRow>

      <SettingRow
        label="关闭按钮行为"
        path="general.closeBehavior"
        description="点击窗口右上角关闭按钮时如何处理"
      >
        <select
          value={settings.general.closeBehavior}
          onChange={(e) => onSave('general.closeBehavior', e.target.value)}
          className={INPUT_SM}
        >
          <option value="ask">每次询问</option>
          <option value="tray">最小化到托盘</option>
          <option value="exit">退出应用</option>
        </select>
      </SettingRow>

      <SettingRow
        label="Agent 执行超时"
        path="general.agentTimeoutMins"
        description="单个 Agent 任务最长执行时间(分钟),超时自动中止;-1 表示不限"
      >
        <input
          type="number"
          min={-1}
          max={1440}
          step={1}
          value={settings.general.agentTimeoutMins}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(v) && (v === -1 || (v >= 1 && v <= 1440))) {
              onSave('general.agentTimeoutMins', v)
            } else {
              toast.error('请输入 -1 或 1-1440 之间的整数')
            }
          }}
          className={cn(INPUT_SM, 'w-24')}
        />
      </SettingRow>

      <SettingRow
        label="Cron 最大并发"
        path="general.maxConcurrentCronTasks"
        description="cron 定时任务同时运行的最大数量,超过则排队等待"
      >
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={settings.general.maxConcurrentCronTasks}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(v) && v >= 1 && v <= 20) {
              onSave('general.maxConcurrentCronTasks', v)
            } else {
              toast.error('请输入 1-20 之间的整数')
            }
          }}
          className={cn(INPUT_SM, 'w-24')}
        />
      </SettingRow>

      <SettingRow
        label="日志级别"
        path="general.logLevel"
        description="控制主进程和渲染进程的日志输出详细程度(5 档)"
      >
        <select
          value={settings.general.logLevel}
          onChange={(e) => onSave('general.logLevel', e.target.value)}
          className={INPUT_SM}
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
          onChange={(v) => onSave('general.autoUpdate', v)}
          label="自动更新"
        />
      </SettingRow>

      <SettingRow
        label="更新源"
        path="general.updateUrl"
        description="GitHub 仓库地址，用于检查更新（如 https://github.com/owner/repo）"
      >
        <input
          type="url"
          value={settings.general.updateUrl}
          placeholder="https://github.com/owner/repo"
          // R8 / 4C 修复: 校验 URL 格式 + 仅允许 http(s),防止用户误填 javascript:/file:
          // 等危险 scheme 被 update-service 当作请求目标。
          onChange={(e) => {
            const v = e.target.value.trim()
            if (v === '') {
              onSave('general.updateUrl', v)
              return
            }
            try {
              const u = new URL(v)
              if (u.protocol === 'http:' || u.protocol === 'https:') {
                onSave('general.updateUrl', v)
              } else {
                toast.error(`不支持的协议: ${u.protocol} (仅允许 http/https)`)
              }
            } catch {
              toast.error('URL 格式不正确')
            }
          }}
          className={cn(INPUT_SM, 'w-56')}
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
              toast.error(t('toast.settings.checkUpdateFailed'))
            }
          }}
          className={cn(
            btnStyle('secondary'),
            'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
          )}
        >
          检查更新
        </button>
      </SettingRow>
    </Section>
  )
}
