// =============================================================
// Approval Store — HITL (Human-in-the-Loop) 审批状态管理
//
// 职责:
//   - 作为 `agent:approval-required` 事件的唯一订阅者
//   - 维护当前弹出的审批请求队列
//   - 提供 approve / reject / edit 动作,调用 `agent:approval-resolve`
//   - 监听 `agent:approval-resolved` 清理已完成请求
//
// 设计:
//   - 把 IPC 订阅收敛在 store,避免多个组件各自 listen
//   - UI 通过 pending 状态渲染 AgentApprovalDialog
// =============================================================

import type { ApprovalDecision, ApprovalRequest } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

interface ApprovalState {
  /** 当前挂起的审批请求队列（FIFO） */
  pending: ApprovalRequest[]
  /** 当前是否正在提交决议 */
  resolving: boolean

  // 内部
  _unsubscribeRequired: (() => void) | null
  _unsubscribeResolved: (() => void) | null
  initListeners: () => void
  disposeListeners: () => void

  /** 用户批准 */
  approve: (by: string) => Promise<void>
  /** 用户拒绝 */
  reject: (by: string, reason: string) => Promise<void>
  /** 用户编辑参数后批准 */
  edit: (by: string, newArgs: Record<string, unknown>) => Promise<void>
  /** 跳过/关闭当前弹窗（不发送决议,请求仍保留在后端 pending 中） */
  dismiss: () => void
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pending: [],
  resolving: false,
  _unsubscribeRequired: null,
  _unsubscribeResolved: null,

  initListeners: () => {
    const oldReq = get()._unsubscribeRequired
    const oldRes = get()._unsubscribeResolved
    if (oldReq || oldRes) return // 已初始化

    const unsubReq = getAPI().agent.onApprovalRequired((req) => {
      set((s) => ({
        pending: [...s.pending, req],
      }))
      toast.info(`Agent 请求执行「${req.tool}」需要人工审批`)
    })

    const unsubRes = getAPI().agent.onApprovalResolved((requestId) => {
      set((s) => ({
        pending: s.pending.filter((r) => r.id !== requestId),
      }))
    })

    set({ _unsubscribeRequired: unsubReq, _unsubscribeResolved: unsubRes })
  },

  disposeListeners: () => {
    get()._unsubscribeRequired?.()
    get()._unsubscribeResolved?.()
    set({ _unsubscribeRequired: null, _unsubscribeResolved: null })
  },

  approve: async (by) => {
    const { pending } = get()
    if (pending.length === 0) return
    const req = pending[0]
    set({ resolving: true })
    try {
      const decision: ApprovalDecision = { type: 'approve', by }
      await getAPI().agent.resolveApproval(req.id, decision)
      set((s) => ({ pending: s.pending.filter((r) => r.id !== req.id) }))
    } catch (err) {
      console.error('[ApprovalStore] approve failed:', err)
      toast.error('审批通过失败')
    } finally {
      set({ resolving: false })
    }
  },

  reject: async (by, reason) => {
    const { pending } = get()
    if (pending.length === 0) return
    const req = pending[0]
    set({ resolving: true })
    try {
      const decision: ApprovalDecision = { type: 'reject', by, reason }
      await getAPI().agent.resolveApproval(req.id, decision)
      set((s) => ({ pending: s.pending.filter((r) => r.id !== req.id) }))
    } catch (err) {
      console.error('[ApprovalStore] reject failed:', err)
      toast.error('审批拒绝失败')
    } finally {
      set({ resolving: false })
    }
  },

  edit: async (by, newArgs) => {
    const { pending } = get()
    if (pending.length === 0) return
    const req = pending[0]
    set({ resolving: true })
    try {
      const decision: ApprovalDecision = { type: 'edit', by, newArgs }
      await getAPI().agent.resolveApproval(req.id, decision)
      set((s) => ({ pending: s.pending.filter((r) => r.id !== req.id) }))
    } catch (err) {
      console.error('[ApprovalStore] edit failed:', err)
      toast.error('编辑参数后批准失败')
    } finally {
      set({ resolving: false })
    }
  },

  dismiss: () => {
    set((s) => ({ pending: s.pending.slice(1) }))
  },
}))
