// =============================================================
// useConfirmDialog — 确认对话框状态 hook
// 统一页面里手写的 {open: boolean, payload: T | null} + setOpen(false)
// 样板。void 场景（纯确认）和带 payload 场景（如删除前缓存 id）共用。
// =============================================================

import { useCallback, useState } from 'react'

export interface ConfirmDialogState<TPayload> {
  open: boolean
  payload: TPayload | null
}

export function useConfirmDialog<TPayload = void>(): {
  state: ConfirmDialogState<TPayload>
  open: (payload?: TPayload) => void
  close: () => void
  isOpen: boolean
} {
  const [state, setState] = useState<ConfirmDialogState<TPayload>>({
    open: false,
    payload: null,
  })

  const open = useCallback((payload?: TPayload) => {
    setState({ open: true, payload: (payload ?? null) as TPayload | null })
  }, [])

  const close = useCallback(() => {
    setState({ open: false, payload: null })
  }, [])

  return { state, open, close, isOpen: state.open }
}
