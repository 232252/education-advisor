// =============================================================
// 会话产出文件面板 — 列出本会话工作目录的产出，支持另存为。
// 数据来自 workspace.listFiles（主进程防穿越校验）。
// =============================================================

import type { WorkspaceFileEntry } from '@shared/api/workspace'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function SessionFilesPanel({ sessionId }: { sessionId: string }) {
  const { t } = useT()
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }
    setLoading(true)
    try {
      const res = await getAPI().workspace.listFiles(sessionId)
      setFiles(res.success ? res.files : [])
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveAs = async (relPath: string) => {
    try {
      await getAPI().workspace.saveAs(sessionId, relPath)
    } catch {
      /* 另存失败不阻断面板 */
    }
  }

  if (!sessionId) return null

  return (
    <div className="border-t border-gray-200/60 dark:border-white/[0.06] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {t('page.chat.files.title', '本会话产出')}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[10px] text-blue-500 hover:text-blue-600"
        >
          {t('page.chat.files.refresh', '刷新')}
        </button>
      </div>
      {loading ? (
        <div className="text-[11px] text-gray-400">{t('common.loading', '加载中...')}</div>
      ) : files.length === 0 ? (
        <div className="text-[11px] text-gray-400">
          {t('page.chat.files.empty', '本会话还没有产出文件')}
        </div>
      ) : (
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-gray-600 dark:text-gray-300" title={f.path}>
                {f.path}
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-gray-400">{formatSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => void saveAs(f.path)}
                  className="text-blue-500 hover:text-blue-600"
                >
                  {t('page.chat.files.saveAs', '另存')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
