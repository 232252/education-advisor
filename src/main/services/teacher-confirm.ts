// =============================================================
// 教师点击确认 — 对话工具在主进程里停下，等界面 ConfirmDialog
//
// confirm:true 是模型自己填的参数，不能当作教师已经点过确认。
// 高费用（极致 AI）和破坏性写入（删考试）走这里：把请求推到渲染进程，
// Promise 直到教师点确认或取消才结束。取消时调用方不得落库。
// =============================================================

import { randomUUID } from 'node:crypto'

export type TeacherConfirmKind = 'extreme-grading' | 'delete-exam'

export interface TeacherConfirmRequest {
  id: string
  kind: TeacherConfirmKind
  /** 任务名或考试名，展示用，不是文案 */
  detail?: string
}

type Waiter = {
  resolve: (accepted: boolean) => void
  reject: (err: Error) => void
}

const waiters = new Map<string, Waiter>()

export type TeacherConfirmSender = (req: TeacherConfirmRequest) => void

let sender: TeacherConfirmSender | null = null

export function setTeacherConfirmSender(next: TeacherConfirmSender | null): void {
  sender = next
}

/** 渲染进程回传。未知 id 返回 false，不抛。 */
export function resolveTeacherConfirm(id: string, accepted: boolean): boolean {
  const waiter = waiters.get(id)
  if (!waiter) return false
  waiters.delete(id)
  waiter.resolve(accepted)
  return true
}

export function resetTeacherConfirmForTests(): void {
  for (const waiter of waiters.values()) {
    waiter.reject(new Error('教师确认已重置'))
  }
  waiters.clear()
  sender = null
}

function cancelledMessage(kind: TeacherConfirmKind): string {
  if (kind === 'extreme-grading') return '教师取消了极致 AI 模式，未创建或更改任务'
  return '教师取消了删除考试，未删除'
}

/**
 * 弹出确认并等待教师点击。true=确认，false=取消。
 * 没有窗口、或本轮已被中止时抛错，调用方不得继续写入。
 */
export async function requestTeacherConfirm(
  input: { kind: TeacherConfirmKind; detail?: string },
  signal?: AbortSignal,
): Promise<boolean> {
  if (!sender) {
    throw new Error('教师确认窗口不可用，操作已取消')
  }
  if (signal?.aborted) {
    throw new Error('教师确认已中断，操作已取消')
  }
  const req: TeacherConfirmRequest = {
    id: randomUUID(),
    kind: input.kind,
    detail: input.detail,
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => {
      waiters.delete(req.id)
      finish(() => reject(new Error('教师确认已中断，操作已取消')))
    }
    waiters.set(req.id, {
      resolve: (accepted) => finish(() => resolve(accepted)),
      reject: (err) => finish(() => reject(err)),
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      sender?.(req)
    } catch (err) {
      waiters.delete(req.id)
      finish(() => reject(err instanceof Error ? err : new Error(String(err))))
    }
  })
}

/** 教师点取消时抛错，调用方必须放在任何写入之前。 */
export async function requireTeacherConfirm(
  input: { kind: TeacherConfirmKind; detail?: string },
  signal?: AbortSignal,
): Promise<void> {
  const accepted = await requestTeacherConfirm(input, signal)
  if (!accepted) throw new Error(cancelledMessage(input.kind))
}
