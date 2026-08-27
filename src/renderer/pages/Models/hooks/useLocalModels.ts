// =============================================================
// useLocalModels — 本地模型(Ollama)状态/轮询与动作 handlers
// 状态与逻辑自 LocalModelsSection.tsx 逐字搬移,行为不变
// =============================================================

import type { OllamaModelInfo, OllamaPullProgressInfo, OllamaStatusInfo } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useLocalModels() {
  const { t } = useT()
  const [status, setStatus] = useState<OllamaStatusInfo | null>(null)
  const [installed, setInstalled] = useState<OllamaModelInfo[]>([])
  const [pulling, setPulling] = useState<string | null>(null)
  const [progress, setProgress] = useState<OllamaPullProgressInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = await getAPI().ollama.detect()
      setStatus(st)
      if (st.serveRunning) {
        const models = await getAPI().ollama.listModels()
        setInstalled(models)
      } else {
        setInstalled([])
      }
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = getAPI().ollama.onPullProgress((info) => {
      setProgress(info)
    })
    // 定时刷新状态(检测 ollama 启动)
    const timer = setInterval(refresh, 10000)
    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [refresh])

  const handleStartServe = async () => {
    try {
      const r = await getAPI().ollama.startServe()
      if (r.success) {
        toast.success(t('toast.models.ollamaStarted'))
        await refresh()
      } else {
        toast.error(t('toast.models.ollamaStartFailed'))
      }
    } catch (err) {
      // R2-14: 此前裸 await 无兜底 — IPC 抛错变 unhandled rejection,UI 无任何反馈
      console.error('[useLocalModels] startServe failed:', err)
      toast.error(
        `${t('toast.models.ollamaStartFailed')} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }

  const handlePull = async (tag: string) => {
    if (pulling) return
    setPulling(tag)
    setProgress({ model: tag, status: 'starting' })
    try {
      const r = await getAPI().ollama.pullModel(tag)
      if (r.success) {
        toast.success(`${tag} 下载完成`)
        await refresh()
      } else {
        toast.error(`下载失败: ${r.error}`)
      }
    } catch (err) {
      console.error('[useLocalModels] pullModel failed:', err)
      toast.error(`下载异常: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPulling(null)
      setProgress(null)
    }
  }

  const handleDelete = async (name: string) => {
    try {
      const r = await getAPI().ollama.deleteModel(name)
      if (r.success) {
        toast.success(`已删除 ${name}`)
        await refresh()
      } else {
        toast.error(`删除失败: ${r.error}`)
      }
    } catch (err) {
      console.error('[useLocalModels] deleteModel failed:', err)
      toast.error(`删除异常: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const serveRunning = status?.serveRunning ?? false
  const available = status?.available ?? false

  return {
    installed,
    pulling,
    progress,
    serveRunning,
    available,
    handleStartServe,
    handlePull,
    handleDelete,
  }
}
