// =============================================================
// useLocalModels — 本地模型(Ollama)状态/轮询与动作 handlers
// 状态与逻辑自 LocalModelsSection.tsx 逐字搬移,行为不变
// =============================================================

import type { OllamaModelInfo, OllamaPullProgressInfo, OllamaStatusInfo } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { errText, getAPI } from '../../../lib/ipc-client'
import { runIpcMutation } from '../../../lib/mutation'
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

  const handleStartServe = () =>
    runIpcMutation(() => getAPI().ollama.startServe(), {
      // 原行为: 信封失败恒显固定文案(不透出 r.error)
      failMsg: () => t('toast.models.ollamaStartFailed'),
      onOk: async () => {
        toast.success(t('toast.models.ollamaStarted'))
        await refresh()
      },
      // R2-14: 此前裸 await 无兜底 — IPC 抛错变 unhandled rejection,UI 无任何反馈
      catchMsg: (err) => `${t('toast.models.ollamaStartFailed')} (${errText(err)})`,
      catchLog: '[useLocalModels] startServe failed:',
    })

  const handlePull = (tag: string) => {
    if (pulling) return
    setPulling(tag)
    setProgress({ model: tag, status: 'starting' })
    return runIpcMutation(() => getAPI().ollama.pullModel(tag), {
      failMsg: (r) => tr('models.local.downloadFailed', { err: r.error ?? '' }),
      onOk: async () => {
        toast.success(tr('models.local.downloadDone', { tag }))
        await refresh()
      },
      catchMsg: (err) => tr('models.local.downloadError', { err: errText(err) }),
      catchLog: '[useLocalModels] pullModel failed:',
      // busy 孪生只有复位段: 置位段由上方 setPulling/setProgress 定制值完成
      setBusy: (v) => {
        if (!v) {
          setPulling(null)
          setProgress(null)
        }
      },
    })
  }

  const handleDelete = (name: string) =>
    runIpcMutation(() => getAPI().ollama.deleteModel(name), {
      failMsg: (r) => tr('models.local.deleteFailed', { err: r.error ?? '' }),
      onOk: async () => {
        toast.success(tr('models.local.deleted', { name }))
        await refresh()
      },
      catchMsg: (err) => tr('models.local.deleteError', { err: errText(err) }),
      catchLog: '[useLocalModels] deleteModel failed:',
    })

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
