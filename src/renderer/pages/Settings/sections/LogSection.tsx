// =============================================================
// 日志查看 Section — 列表 / 级别过滤 / 搜索(防抖)/ 导出 / 清空
// 实时查看 logs/ 目录下的 main / chat / renderer 三类日志(按日期分割)。
// 注: 日志相关 state(logFiles / logContent / selectedLog / logLevelFilter /
// logSearchQuery)保留在 SettingsPage,本组件仅做展示 + 回调通知。
// 搜索防抖已接入 useDebouncedCallback,替代原先手写 timerRef + cleanup。
// =============================================================

import { useDebouncedCallback } from '../../../hooks/useDebouncedCallback'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { Section } from '../components'

type LogLevelFilter = string

export interface LogSectionProps {
  logFiles: Array<{ stream: string; date: string; name: string; sizeBytes: number }>
  logContent: string
  selectedLog: string
  logLevelFilter: LogLevelFilter
  logSearchQuery: string
  // state setter
  setLogFiles: (
    files: Array<{ stream: string; date: string; name: string; sizeBytes: number }>,
  ) => void
  setLogContent: (s: string) => void
  setSelectedLog: (s: string) => void
  setLogLevelFilter: (s: string) => void
  setLogSearchQuery: (s: string) => void
  // 通知父组件弹出清空日志确认对话框
  onClearLogsRequest: () => void
}

export function LogSection({
  logFiles,
  logContent,
  selectedLog,
  logLevelFilter,
  logSearchQuery,
  setLogFiles,
  setLogContent,
  setSelectedLog,
  setLogLevelFilter,
  setLogSearchQuery,
  onClearLogsRequest,
}: LogSectionProps) {
  const { t } = useT()

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
                  toast.error(t('toast.settings.refreshLogsFailed'))
                }
              }}
              className="text-[10px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
            >
              刷新列表
            </button>
            <button
              type="button"
              onClick={onClearLogsRequest}
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
              className="bg-gray-50 dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded-lg px-1.5 py-1 text-[10px] text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
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
                  toast.success(`已导出 ${result.bytes} 字节到 ${result.path}`)
                } else {
                  toast.warning(t('toast.settings.exportEmpty'))
                }
              } catch (err) {
                console.error('[Settings] log export failed:', err)
                toast.error(t('toast.settings.exportLogFailed'))
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
            尚无日志文件。App 启动并产生日志后会出现在此。
          </div>
        )}
      </div>
    </Section>
  )
}
