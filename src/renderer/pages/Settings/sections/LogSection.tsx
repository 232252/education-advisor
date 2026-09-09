// =============================================================
// 日志查看 Section — 列表 / 级别过滤 / 搜索(防抖)/ 导出 / 清空
// 实时查看 logs/ 目录下的 main / chat / renderer 三类日志(按日期分割)。
// 状态自持(2026-09-05 下沉): logFiles/logContent/selectedLog/过滤/搜索
// 与清空确认框全部收归本节,SettingsPage 不再透传 11 个 props。
// 搜索防抖已接入 useDebouncedCallback,替代原先手写 timerRef + cleanup。
// =============================================================

import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useConfirmDialog } from '../../../hooks/useConfirmDialog'
import { useDebouncedCallback } from '../../../hooks/useDebouncedCallback'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { BTN_SM_BLUE, BTN_SM_GRAY } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { Section } from '../components'

export function LogSection() {
  const { t } = useT()
  const [logFiles, setLogFiles] = useState<
    Array<{ stream: string; date: string; name: string; sizeBytes: number }>
  >([])
  const [logContent, setLogContent] = useState('')
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all')
  const [logSearchQuery, setLogSearchQuery] = useState<string>('')
  // 清空日志确认(随状态一并下沉,原先挂在 SettingsPage 的 ConfirmDialog)
  const clearLogsConfirm = useConfirmDialog<void>()

  // 搜索防抖(接入 useDebouncedCallback,替代手写 timerRef + cleanup effect)
  // useDebouncedCallback 内部用 fnRef 持有最新闭包,调用时总是访问最新的
  // selectedLog / logLevelFilter,无需 useCallback 依赖管理。
  // H-9 修复: 300ms 防抖,避免每次按键都触发 IPC 搜索导致卡顿
  const debouncedRunSearch = useDebouncedCallback((q: string, logName: string) => {
    if (!logName) return
    void (async () => {
      try {
        const content = q.trim()
          ? await getAPI().log.search(logName, q, 200)
          : logLevelFilter === 'all'
            ? await getAPI().log.read(logName, 200)
            : await getAPI().log.filter(logName, [logLevelFilter], 200)
        setLogContent(content)
      } catch (err) {
        console.warn('[Settings] log search failed:', err)
      }
    })()
  }, 300)

  return (
    <Section title={t('settings.section.logs', '日志查看')}>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t(
              'page.settings.logs.desc',
              '实时查看 logs/ 目录下的 main / chat / renderer 三类日志,按日期分割',
            )}
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
                  toast.error(t('toast.settings.refreshLogsFailed'))
                }
              }}
              className={BTN_SM_GRAY}
            >
              {t('settings.logs.refresh', '刷新列表')}
            </button>
            <button
              type="button"
              onClick={() => clearLogsConfirm.open()}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
            >
              {t('settings.logs.clear', '清空')}
            </button>
          </div>
        </div>

        {/* T3: 增强工具栏 — level 过滤 + 搜索 + 导出 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {t('page.settings.logs.levelLabel', '级别:')}
            </span>
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
              className="bg-gray-50 dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded-lg px-1.5 py-1 text-[10px] text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            >
              <option value="all">{t('settings.logs.level.all', '全部')}</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <input
            type="text"
            value={logSearchQuery}
            placeholder={t('settings.logs.search.placeholder', '搜索日志内容...')}
            onChange={(e) => {
              const v = e.target.value
              setLogSearchQuery(v)
              // H-9 修复: 300ms 防抖,避免每次按键都触发 IPC 搜索导致卡顿
              debouncedRunSearch(v, selectedLog)
            }}
            className="flex-1 min-w-[120px] bg-gray-50 dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded-lg px-2.5 py-1 text-[10px] text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
          />

          <button
            type="button"
            onClick={async () => {
              if (!selectedLog) {
                toast.warning(t('toast.settings.selectLogFirst'))
                return
              }
              // H-6 修复: 加 try/catch,避免导出失败时无反馈
              try {
                const result = await getAPI().log.exportWithDialog(selectedLog)
                if (result.canceled) return
                if (result.bytes > 0) {
                  toast.success(
                    `${t('page.settings.logs.exportedPrefix', '已导出 ')}${result.bytes}${t('page.settings.logs.exportedInfix', ' 字节到 ')}${result.path}`,
                  )
                } else {
                  toast.warning(t('toast.settings.exportEmpty'))
                }
              } catch (err) {
                console.error('[Settings] log export failed:', err)
                toast.error(t('toast.settings.exportLogFailed'))
              }
            }}
            disabled={!selectedLog}
            className={BTN_SM_BLUE}
          >
            {t('settings.logs.export', '导出')}
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
                    setLogContent(t('page.settings.logs.readFailed', '读取日志失败,请查看控制台'))
                  }
                }}
                className={`text-[10px] px-2 py-1 rounded-lg border ${
                  selectedLog === f.name
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-600 dark:text-blue-200'
                    : 'border-gray-300 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]/30'
                }`}
              >
                {f.stream}/{f.date} ({Math.round(f.sizeBytes / 1024)}KB)
              </button>
            ))}
          </div>
        )}

        {logContent && (
          <pre className="bg-gray-50 dark:bg-surface-tertiary/60 border border-gray-200 dark:border-white/[0.06] rounded-lg p-3 text-[10px] text-gray-700 dark:text-gray-300 max-h-64 overflow-y-auto font-mono whitespace-pre-wrap leading-relaxed">
            {logContent}
          </pre>
        )}

        {logFiles.length === 0 && !logContent && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">
            {t('settings.logs.empty', '尚无日志文件。App 启动并产生日志后会出现在此。')}
          </div>
        )}
      </div>

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
    </Section>
  )
}
