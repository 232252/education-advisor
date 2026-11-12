// =============================================================
// 教师点击确认 API — 对话工具暂停时渲染进程弹出 ConfirmDialog
// =============================================================

export type TeacherConfirmKind = 'extreme-grading' | 'delete-exam'

export interface TeacherConfirmRequest {
  id: string
  kind: TeacherConfirmKind
  detail?: string
}

export interface TeacherConfirmAPI {
  /** 教师点了确认或取消 */
  respond: (id: string, accepted: boolean) => Promise<{ success: boolean; data?: boolean }>
  /** 订阅主进程弹出的确认请求，返回退订函数 */
  onRequest: (callback: (req: TeacherConfirmRequest) => void) => () => void
}
