// =============================================================
// 通用设置 Section — 主题/语言/数据目录/开机启动/托盘/日志级别/更新
// SettingRow: theme / language / dataDir / autoStart / minimizeToTray
//             / closeBehavior / logLevel / autoUpdate / updateUrl / checkUpdate
// M31: 检查更新扩展为完整流 — 发现新版本 → 下载并安装(进度条) → 重启安装
//      portable 版显示"手动替换"提示,不提供自动安装
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useEffect, useState } from 'react'
import { setLang, useT } from '../../../i18n'
import type { CheckUpdateResult, UpdateProgressInfo } from '../../../lib/ipc/sys'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { Section, SettingRow, ToggleSwitch } from '../components'

/** 更新流程 UI 状态机: 检查前 → 发现新版本 → 下载中 → 下载完成待安装 */
type UpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded'

export interface GeneralSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function GeneralSection({ settings, onSave }: GeneralSectionProps) {
  const { t } = useT()

  // ===== 自动更新 (M31) =====
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null)
  const [progress, setProgress] = useState<UpdateProgressInfo | null>(null)

  // 订阅主进程下载进度推送 (sys:update-progress,参考 ollama pull-progress 模式)
  useEffect(() => {
    const unsub = getAPI().sys.onUpdateProgress((info) => {
      setProgress(info)
      if (info.status === 'downloaded') {
        setPhase('downloaded')
        toast.success(t('toast.settings.updateDownloadDone', '更新下载完成'))
      } else if (info.status === 'error') {
        // 错误详情由 downloadUpdate 返回值提示,这里仅回退到"可下载"状态
        setPhase('available')
      }
    })
    return unsub
  }, [t])

  const handleCheck = async () => {
    // H-6 修复: 加 try/catch,避免检查更新失败时无反馈
    try {
      const result = await getAPI().sys.checkUpdate()
      if (result.hasUpdate) {
        // M31: 发现新版本 → 显示"下载并安装"入口 (portable 版提示手动替换)
        setUpdateResult(result)
        setPhase('available')
      } else {
        toast.success(
          result.message ||
            `${t('page.settings.general.upToDatePrefix', '已是最新版本 v')}${result.currentVersion}`,
        )
      }
    } catch (err) {
      console.error('[Settings] checkUpdate failed:', err)
      toast.error(t('toast.settings.checkUpdateFailed'))
    }
  }

  const handleDownload = async () => {
    setPhase('downloading')
    setProgress(null)
    try {
      const r = await getAPI().sys.downloadUpdate()
      if (!r.success) {
        setPhase('available')
        toast.error(`${t('toast.settings.updateDownloadFailed', '下载更新失败')}: ${r.error ?? ''}`)
      }
      // 成功时由 update-downloaded 事件切换到 'downloaded' 相位
    } catch (err) {
      console.error('[Settings] downloadUpdate failed:', err)
      setPhase('available')
      toast.error(t('toast.settings.updateDownloadFailed', '下载更新失败'))
    }
  }

  const handleInstall = async () => {
    try {
      const r = await getAPI().sys.installUpdate()
      if (!r.success) {
        if (r.portable) {
          toast.error(t('toast.settings.updatePortable', '便携版请手动下载替换文件更新'))
        } else {
          toast.error(
            `${t('toast.settings.updateInstallFailed', '安装更新失败')}: ${r.error ?? ''}`,
          )
        }
      }
      // 成功时 quitAndInstall 退出应用并运行安装器
    } catch (err) {
      console.error('[Settings] installUpdate failed:', err)
      toast.error(t('toast.settings.updateInstallFailed', '安装更新失败'))
    }
  }

  return (
    <Section title={t('settings.section.general')}>
      <SettingRow
        label={t('settings.theme', '主题')}
        path="general.theme"
        description={t('settings.theme.desc', '界面外观,system 表示跟随操作系统')}
      >
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
        label={t('settings.language', '语言')}
        path="general.language"
        description={t(
          'page.settings.general.languageDesc',
          '界面语言,useT hook 自动响应切换 (部分静态文案需重启)',
        )}
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
          <option value="zh-CN">{t('settings.language.zh', '中文')}</option>
          <option value="en-US">{t('settings.language.en', 'English')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.dataDir', '数据目录')}
        path="general.dataDir"
        description={settings.general.dataDir}
      >
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {settings.general.dataDir || t('common.dash', '—')}
        </span>
      </SettingRow>

      <SettingRow
        label={t('page.settings.general.timezone', '时区')}
        path="general.timezone"
        description={t(
          'page.settings.general.timezoneDesc',
          'cron 定时任务的调度时区,影响每日重置/定时报告的触发时间',
        )}
      >
        <select
          value={settings.general.timezone}
          onChange={(e) => onSave('general.timezone', e.target.value)}
          className={INPUT_SM}
        >
          <option value="Asia/Shanghai">
            {t('page.settings.general.timezoneShanghai', '亚洲/上海 (UTC+8)')}
          </option>
          <option value="Asia/Tokyo">
            {t('page.settings.general.timezoneTokyo', '亚洲/东京 (UTC+9)')}
          </option>
          <option value="Asia/Singapore">
            {t('page.settings.general.timezoneSingapore', '亚洲/新加坡 (UTC+8)')}
          </option>
          <option value="America/Los_Angeles">
            {t('page.settings.general.timezoneLosAngeles', '美洲/洛杉矶 (UTC-8)')}
          </option>
          <option value="America/New_York">
            {t('page.settings.general.timezoneNewYork', '美洲/纽约 (UTC-5)')}
          </option>
          <option value="Europe/London">
            {t('page.settings.general.timezoneLondon', '欧洲/伦敦 (UTC+0)')}
          </option>
          <option value="UTC">UTC</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.autoStart', '开机启动')}
        path="general.autoStart"
        description={t('settings.autoStart.desc', '操作系统启动时自动运行 Education Advisor')}
      >
        <ToggleSwitch
          checked={settings.general.autoStart}
          onChange={(v) => onSave('general.autoStart', v)}
          label={t('settings.autoStart', '开机启动')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.minimizeToTray', '最小化到托盘')}
        path="general.minimizeToTray"
        description={t('settings.minimizeToTray.desc', '关闭窗口时最小化到系统托盘,不退出')}
      >
        <ToggleSwitch
          checked={settings.general.minimizeToTray}
          onChange={(v) => onSave('general.minimizeToTray', v)}
          label={t('settings.minimizeToTray', '最小化到托盘')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.closeBehavior', '关闭按钮行为')}
        path="general.closeBehavior"
        description={t('settings.closeBehavior.desc', '点击窗口右上角关闭按钮时如何处理')}
      >
        <select
          value={settings.general.closeBehavior}
          onChange={(e) => onSave('general.closeBehavior', e.target.value)}
          className={INPUT_SM}
        >
          <option value="ask">{t('settings.closeBehavior.ask', '每次询问')}</option>
          <option value="tray">{t('settings.closeBehavior.minimize', '最小化到托盘')}</option>
          <option value="exit">{t('settings.closeBehavior.exit', '退出应用')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('page.settings.general.agentTimeout', 'Agent 执行超时')}
        path="general.agentTimeoutMins"
        description={t(
          'page.settings.general.agentTimeoutDesc',
          '单个 Agent 任务最长执行时间(分钟),超时自动中止;-1 表示不限',
        )}
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
              toast.error(t('toast.settings.agentTimeoutInvalid', '请输入 -1 或 1-1440 之间的整数'))
            }
          }}
          className={cn(INPUT_SM, 'w-24')}
        />
      </SettingRow>

      <SettingRow
        label={t('page.settings.general.maxConcurrent', 'Cron 最大并发')}
        path="general.maxConcurrentCronTasks"
        description={t(
          'page.settings.general.maxConcurrentDesc',
          'cron 定时任务同时运行的最大数量,超过则排队等待',
        )}
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
              toast.error(t('toast.settings.maxConcurrentInvalid', '请输入 1-20 之间的整数'))
            }
          }}
          className={cn(INPUT_SM, 'w-24')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.logLevel', '日志级别')}
        path="general.logLevel"
        description={t(
          'page.settings.general.logLevelDesc',
          '控制主进程和渲染进程的日志输出详细程度(5 档)',
        )}
      >
        <select
          value={settings.general.logLevel}
          onChange={(e) => onSave('general.logLevel', e.target.value)}
          className={INPUT_SM}
        >
          <option value="debug">{t('settings.logLevel.debug', 'Debug (全日志)')}</option>
          <option value="info">{t('settings.logLevel.info', 'Info (重要事件)')}</option>
          <option value="warn">{t('settings.logLevel.warn', 'Warn (警告)')}</option>
          <option value="error">{t('settings.logLevel.error', 'Error (仅错误)')}</option>
          <option value="off">{t('settings.logLevel.off', 'Off (关闭)')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.autoUpdate', '自动更新')}
        path="general.autoUpdate"
        description={t('page.settings.general.autoUpdateDesc', '启动时自动检查新版本')}
      >
        <ToggleSwitch
          checked={settings.general.autoUpdate}
          onChange={(v) => onSave('general.autoUpdate', v)}
          label={t('settings.autoUpdate', '自动更新')}
        />
      </SettingRow>

      <SettingRow
        label={t('page.settings.general.updateUrl', '更新源')}
        path="general.updateUrl"
        description={t(
          'page.settings.general.updateUrlDesc',
          'GitHub 仓库地址，用于检查更新（如 https://github.com/owner/repo）',
        )}
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
                toast.error(
                  `${t('toast.settings.updateUrlProtocolPrefix', '不支持的协议: ')}${u.protocol}${t('toast.settings.updateUrlProtocolSuffix', ' (仅允许 http/https)')}`,
                )
              }
            } catch {
              toast.error(t('toast.settings.updateUrlInvalid', 'URL 格式不正确'))
            }
          }}
          className={cn(INPUT_SM, 'w-56')}
        />
      </SettingRow>

      <SettingRow
        label={t('page.settings.general.checkUpdate', '检查更新')}
        path="general.checkUpdate"
        description={t('page.settings.general.checkUpdateDesc', '手动检查是否有新版本可用')}
      >
        {/* M31: 检查 → 发现新版本 → 下载(进度条) → 重启安装 状态机 */}
        <div className="flex flex-col items-end gap-1.5">
          {phase === 'idle' && (
            <button
              type="button"
              onClick={() => void handleCheck()}
              className={cn(
                btnStyle('secondary'),
                'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
              )}
            >
              {t('page.settings.general.checkUpdate', '检查更新')}
            </button>
          )}

          {phase === 'available' && updateResult && (
            <>
              <span className="text-xs text-blue-600 dark:text-blue-400">
                {t('page.settings.general.updateAvailablePrefix', '发现新版本 v')}
                {updateResult.latestVersion}
              </span>
              {updateResult.portable ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] text-amber-500">
                    {t(
                      'page.settings.general.updateManualHint',
                      '便携版不支持自动安装,请下载后手动替换',
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // 外部链接经 setWindowOpenHandler → shell.openExternal
                      window.open(updateResult.releaseUrl, '_blank')
                    }}
                    className={cn(
                      btnStyle('secondary'),
                      'text-xs bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
                    )}
                  >
                    {t('page.settings.general.updateGoDownload', '前往下载')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  className={cn(
                    btnStyle('secondary'),
                    'text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
                  )}
                >
                  {t('page.settings.general.updateDownloadInstall', '下载并安装')}
                </button>
              )}
            </>
          )}

          {phase === 'downloading' && (
            <div className="w-48 flex flex-col items-end gap-1">
              <div className="h-1.5 w-full bg-gray-200 dark:bg-surface-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress?.percent ?? 0))}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400">
                {t('page.settings.general.updateDownloading', '正在下载更新')}
                {progress ? ` ${Math.round(progress.percent)}%` : ''}
              </span>
            </div>
          )}

          {phase === 'downloaded' && (
            <button
              type="button"
              onClick={() => void handleInstall()}
              className={cn(
                btnStyle('secondary'),
                'text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
              )}
            >
              {t('page.settings.general.updateRestartInstall', '重启并安装')}
            </button>
          )}
        </div>
      </SettingRow>
    </Section>
  )
}
