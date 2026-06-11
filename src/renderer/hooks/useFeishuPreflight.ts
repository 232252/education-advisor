// =============================================================
// useFeishuPreflight — 飞书发送 + 隐私预检 的复用 hook
//
// 用法:
//   const { dialogProps, send } = useFeishuPreflight()
//   await send({ appId, userOpenId, text })
//   // 在 JSX 渲染 <UploadPreflightDialog {...dialogProps} />
//
// 设计要点:
//   - 单例状态:同页多次调用共享同一个对话框
//   - 异步 send:内部走 sendPreflight + sendConfirm
//   - 决策收敛:无 PII → 自动放行;PII 命中 → 打开对话框等用户决定
//   - 失败安全:preflight 调用失败时**保守放行**(同主进程 preflight 语义)
// =============================================================

import { useCallback, useRef, useState } from 'react'
import { type PreflightReport, UploadPreflightDialog } from '../components/UploadPreflightDialog'
import { getAPI } from '../lib/ipc-client'

export interface FeishuSendParams {
  appId: string
  userOpenId: string
  text: string
}

export interface FeishuSendResult {
  success: boolean
  messageId?: string
  error?: string
  blocked?: boolean
  sentTextLength?: number
  /** 用户实际选择的决策 */
  decision: 'cancel' | 'redacted' | 'original' | 'no-pii'
}

export interface UseFeishuPreflightReturn {
  /** 给 <UploadPreflightDialog> 直接展开的属性 */
  dialogProps: {
    open: boolean
    text: string
    action: string
    onDecision: (decision: 'cancel' | 'redacted' | 'original', redacted?: string) => void
  }
  /** 触发发送流程(异步,会等待用户决策) */
  send: (params: FeishuSendParams) => Promise<FeishuSendResult>
  /** 是否正在发送/扫描 */
  isSending: boolean
  /** 上一次发送的错误信息(若失败) */
  lastError: string | null
  /** 清除错误 */
  clearError: () => void
}

export function useFeishuPreflight(): UseFeishuPreflightReturn {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [action, setAction] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  // 用 ref 保存待 resolve 的 Promise,用户在对话框里的决策触发它
  const resolverRef = useRef<((d: 'cancel' | 'redacted' | 'original') => void) | null>(null)
  const pendingParamsRef = useRef<FeishuSendParams | null>(null)
  const preflightReportRef = useRef<{
    hasPII: boolean
    redacted: string
    privacyEnabled: boolean
  } | null>(null)

  const waitForDecision = useCallback(
    () =>
      new Promise<'cancel' | 'redacted' | 'original'>((resolve) => {
        resolverRef.current = resolve
      }),
    [],
  )

  const send = useCallback(
    async (params: FeishuSendParams): Promise<FeishuSendResult> => {
      setIsSending(true)
      setLastError(null)
      pendingParamsRef.current = params
      try {
        // 1. 预检
        const report = await getAPI().feishu.sendPreflight(
          params.appId,
          params.userOpenId,
          params.text,
        )
        preflightReportRef.current = {
          hasPII: report.hasPII,
          redacted: report.redacted,
          privacyEnabled: report.privacyEnabled,
        }

        // 2. 决策
        let decision: 'cancel' | 'redacted' | 'original' | 'no-pii'
        if (report.hasPII) {
          // 打开对话框等用户
          setText(params.text)
          setAction(`发送飞书消息 → ${params.userOpenId}`)
          setOpen(true)
          decision = await waitForDecision()
          setOpen(false)
          if (decision === 'cancel') {
            return {
              success: false,
              error: '用户取消发送',
              decision: 'cancel',
            }
          }
        } else {
          decision = 'no-pii'
        }

        // 3. 真正发送
        const result = await getAPI().feishu.sendConfirm(
          params.appId,
          params.userOpenId,
          params.text,
          decision === 'no-pii' ? 'original' : decision,
        )
        if (!result.success) {
          setLastError(result.error ?? '发送失败')
        }
        return { ...result, decision }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setLastError(msg)
        return { success: false, error: msg, decision: 'cancel' }
      } finally {
        setIsSending(false)
        pendingParamsRef.current = null
        resolverRef.current = null
      }
    },
    [waitForDecision],
  )

  const onDecision = useCallback((decision: 'cancel' | 'redacted' | 'original') => {
    resolverRef.current?.(decision)
  }, [])

  const clearError = useCallback(() => setLastError(null), [])

  return {
    dialogProps: { open, text, action, onDecision },
    send,
    isSending,
    lastError,
    clearError,
  }
}

export type { PreflightReport }
/**
 * 渲染助手:把 dialogProps 配合组件一起用
 * 单独导出方便 import
 */
export { UploadPreflightDialog }
