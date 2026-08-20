// =============================================================
// 数据与备份 Section — 手动备份 / 自动备份 / 备份列表 / 从备份恢复
// SettingRow: manualBackup / autoEnabled / intervalHours / keep
// 恢复为危险操作: ConfirmDialog 确认 → 主进程弹文件选择 →
// 校验 manifest → 恢复前安全备份 → 替换数据 → 确认重启
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../i18n'
import { validateCron } from '../../../lib/cron-utils'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_INVALID, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { Section, SettingRow, ToggleSwitch } from '../components'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export interface DataSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function DataSection({ settings, onSave }: DataSectionProps) {
  const { t } = useT()
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backups, setBackups] = useState<
    Array<{ fileName: string; sizeBytes: number; createdAt: number; kind: 'auto' | 'pre-restore' }>
  >([])
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  // M33: 备份计划 cron 表达式本地编辑态(非法中间态不落盘,合法才 onSave)
  const [cronInput, setCronInput] = useState(settings.backup?.autoBackupCron ?? '0 3 * * *')

  useEffect(() => {
    setCronInput(settings.backup?.autoBackupCron ?? '0 3 * * *')
  }, [settings.backup?.autoBackupCron])

  const cronValidation = validateCron(cronInput)

  const loadBackups = useCallback(async () => {
    try {
      const result = await getAPI().backup.listAuto()
      if (result.success && result.data) setBackups(result.data)
    } catch (err) {
      console.error('[Settings] backup.listAuto failed:', err)
    }
  }, [])

  useEffect(() => {
    loadBackups()
  }, [loadBackups])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const result = await getAPI().backup.createDialog()
      if (result.canceled) return
      if (result.success) {
        toast.success(t('toast.backup.createSuccess', `备份成功 (${result.files ?? 0} 个文件)`))
        loadBackups()
      } else {
        toast.error(`${t('toast.backup.createFailed', '备份失败')}: ${result.error ?? ''}`)
      }
    } catch (err) {
      console.error('[Settings] backup.createDialog failed:', err)
      toast.error(t('toast.backup.createFailed', '备份失败'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (fileName: string) => {
    try {
      const result = await getAPI().backup.deleteAuto(fileName)
      if (result.success) {
        setBackups((prev) => prev.filter((b) => b.fileName !== fileName))
        toast.success(t('toast.backup.deleteSuccess', '备份已删除'))
      } else {
        toast.error(`${t('toast.backup.deleteFailed', '删除失败')}: ${result.error ?? ''}`)
      }
    } catch (err) {
      console.error('[Settings] backup.deleteAuto failed:', err)
      toast.error(t('toast.backup.deleteFailed', '删除失败'))
    }
  }

  const executeRestore = async () => {
    setRestoring(true)
    try {
      const result = await getAPI().backup.restoreDialog()
      if (result.canceled) return
      if (result.success) {
        toast.success(t('toast.backup.restoreSuccess', '恢复完成,重启应用后生效'))
        setConfirmRestart(true)
        loadBackups()
      } else {
        toast.error(`${t('toast.backup.restoreFailed', '恢复失败')}: ${result.error ?? ''}`)
      }
    } catch (err) {
      console.error('[Settings] backup.restoreDialog failed:', err)
      toast.error(t('toast.backup.restoreFailed', '恢复失败'))
    } finally {
      setRestoring(false)
    }
  }

  const backupSettings = settings.backup

  return (
    <Section title={t('settings.section.data', '数据与备份')}>
      <SettingRow
        label={t('settings.backup.manual', '手动备份')}
        path="backup.manual"
        description={t(
          'settings.backup.manualDesc',
          '将设置/学生数据/数据库/定时任务打包为 zip,保存到指定位置',
        )}
      >
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className={`${btnStyle('primary')} text-xs`}
        >
          {creating
            ? t('settings.backup.creating', '备份中…')
            : t('settings.backup.createNow', '立即备份')}
        </button>
      </SettingRow>

      <SettingRow
        label={t('settings.backup.auto', '自动备份')}
        path="backup.autoEnabled"
        description={t(
          'settings.backup.autoDesc',
          '按设定间隔自动备份到应用数据目录的 backups/ 下',
        )}
      >
        <ToggleSwitch
          checked={backupSettings.autoEnabled}
          onChange={(v) => onSave('backup.autoEnabled', v)}
          label={t('settings.backup.auto', '自动备份')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.backup.interval', '备份间隔')}
        path="backup.intervalHours"
        description={t('settings.backup.intervalDesc', '自动备份的触发间隔')}
      >
        <select
          value={String(backupSettings.intervalHours)}
          onChange={(e) => onSave('backup.intervalHours', Number(e.target.value))}
          className={INPUT_SM}
          disabled={!backupSettings.autoEnabled}
        >
          <option value="6">6 {t('page.settings.backup.hoursUnit', '小时')}</option>
          <option value="12">12 {t('page.settings.backup.hoursUnit', '小时')}</option>
          <option value="24">24 {t('page.settings.backup.hoursUnit', '小时')}</option>
          <option value="48">48 {t('page.settings.backup.hoursUnit', '小时')}</option>
          <option value="168">7 {t('page.settings.backup.daysUnit', '天')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.backup.keep', '保留份数')}
        path="backup.keep"
        description={t('settings.backup.keepDesc', '超出后自动清理最旧的备份')}
      >
        <select
          value={String(backupSettings.keep)}
          onChange={(e) => onSave('backup.keep', Number(e.target.value))}
          className={INPUT_SM}
          disabled={!backupSettings.autoEnabled}
        >
          <option value="3">3 {t('settings.backup.countUnit', '份')}</option>
          <option value="5">5 {t('settings.backup.countUnit', '份')}</option>
          <option value="7">7 {t('settings.backup.countUnit', '份')}</option>
          <option value="14">14 {t('settings.backup.countUnit', '份')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.backup.autoCron', '定时自动备份 (cron)')}
        path="backup.autoBackupEnabled"
        description={t(
          'settings.backup.autoCronDesc',
          '按 cron 计划到点自动备份到应用数据目录的 backups/ 下,默认每日 03:00',
        )}
      >
        <ToggleSwitch
          checked={backupSettings.autoBackupEnabled ?? false}
          onChange={(v) => onSave('backup.autoBackupEnabled', v)}
          label={t('settings.backup.autoCron', '定时自动备份 (cron)')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.backup.cronExpr', '备份计划')}
        path="backup.autoBackupCron"
        description={t(
          'settings.backup.cronExprDesc',
          'cron 表达式(分 时 日 月 周),如 0 3 * * * 表示每日 03:00',
        )}
      >
        <div className="flex flex-col items-end">
          <input
            type="text"
            value={cronInput}
            placeholder="0 3 * * *"
            onChange={(e) => {
              const v = e.target.value
              setCronInput(v)
              // 非法中间态只更新本地 state,合法才写入 settings(防坏表达式进调度器)
              if (validateCron(v).valid) onSave('backup.autoBackupCron', v)
            }}
            className={cn(INPUT_SM, 'w-40 font-mono', !cronValidation.valid && INPUT_INVALID)}
            disabled={!backupSettings.autoBackupEnabled}
          />
          {!cronValidation.valid && (
            <div className="text-[10px] mt-1 text-rose-500 dark:text-rose-400">
              {t('settings.backup.cronInvalid', '无效的 cron 表达式')}: {cronValidation.error}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label={t('settings.backup.list', '备份列表')}
        path="backup.list"
        description={t('settings.backup.listDesc', 'backups/ 目录下的自动备份与恢复前安全备份')}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {backups.length} {t('settings.backup.countUnit', '份')}
          </span>
          <button
            type="button"
            onClick={loadBackups}
            className="text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            {t('common.refresh', '刷新')}
          </button>
        </div>
      </SettingRow>

      {backups.length > 0 && (
        <div className="px-5 py-4">
          <div className="rounded-lg border border-gray-200 dark:border-white/[0.06] divide-y divide-gray-100 dark:divide-white/[0.04] max-h-48 overflow-y-auto">
            {backups.map((b) => (
              <div key={b.fileName} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                    {b.fileName}
                    {b.kind === 'pre-restore' && (
                      <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">
                        {t('settings.backup.preRestore', '恢复前安全备份')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">
                    {formatTime(b.createdAt)} · {formatBytes(b.sizeBytes)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(b.fileName)}
                  className="text-[10px] px-2 py-1 rounded-lg text-rose-500 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  {t('common.delete', '删除')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <SettingRow
        label={t('settings.backup.restore', '从备份恢复')}
        path="backup.restore"
        description={t(
          'settings.backup.restoreDesc',
          '选择备份 zip 覆盖当前数据;恢复前会自动做一次安全备份,完成后需重启应用',
        )}
      >
        <button
          type="button"
          onClick={() => setConfirmRestore(true)}
          disabled={restoring}
          className={`${btnStyle('danger')} text-xs`}
        >
          {restoring
            ? t('settings.backup.restoring', '恢复中…')
            : t('settings.backup.restoreNow', '从备份恢复')}
        </button>
      </SettingRow>

      <ConfirmDialog
        open={confirmRestore}
        title={t('settings.backup.restoreConfirmTitle', '从备份恢复')}
        message={t(
          'settings.backup.restoreConfirmMsg',
          '将用备份内容覆盖当前全部核心数据(设置/学生数据/数据库/定时任务)。恢复前会自动创建安全备份,完成后需要重启应用。确定继续?',
        )}
        variant="danger"
        confirmText={t('settings.backup.restoreNow', '从备份恢复')}
        onConfirm={() => {
          setConfirmRestore(false)
          void executeRestore()
        }}
        onCancel={() => setConfirmRestore(false)}
      />

      <ConfirmDialog
        open={confirmRestart}
        title={t('settings.backup.restartTitle', '重启应用')}
        message={t('settings.backup.restartMsg', '数据已恢复,重启后生效。现在重启?')}
        confirmText={t('settings.backup.restartNow', '立即重启')}
        onConfirm={() => {
          setConfirmRestart(false)
          void getAPI().sys.restartApp()
        }}
        onCancel={() => setConfirmRestart(false)}
      />
    </Section>
  )
}
