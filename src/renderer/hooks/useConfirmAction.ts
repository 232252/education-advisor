// =============================================================
// useConfirmAction — 「消息 + 确认回调」型确认对话框状态 hook
//
// 收口 Classes/Students/Scheduler/Skills 等页面各自手写的
// {open, message, onConfirm, variant?} 状态机(与 useConfirmDialog
// 的 payload 型不同构)。state 字段与旧 ConfirmState 逐一同名,
// 页面 JSX(setConfirmState/confirmState.*)零改动即可接入。
// =============================================================

import { useCallback, useState } from 'react'

export interface ConfirmActionState {
  open: boolean
  message: string
  title?: string
  onConfirm: () => void
  variant?: 'default' | 'danger'
}

export function useConfirmAction() {
  const [state, setState] = useState<ConfirmActionState>({
    open: false,
    message: '',
    onConfirm: () => {},
  })

  /** 打开确认框:message 为提示文案,onConfirm 为确认后执行的动作 */
  const ask = useCallback(
    (
      message: string,
      onConfirm: () => void,
      opts?: { title?: string; variant?: 'default' | 'danger' },
    ) => {
      setState({ open: true, message, onConfirm, ...opts })
    },
    [],
  )

  /** 仅关闭对话框(保留上一次 message/onConfirm,与旧 setConfirmState 局部更新语义一致) */
  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  return { state, setState, ask, close }
}
