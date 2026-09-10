// =============================================================
// 仪表盘视图镜头 — 操行优先 / 成绩优先
// 不是「班主任 / 科任」身份切换：班主任也可能要看成绩。
// 偏好持久化到 localStorage，跨会话记住上次选择。
// =============================================================

export const DASHBOARD_LENS_KEY = 'ea-dashboard-lens'
export const DASHBOARD_SUBJECT_KEY = 'ea-dashboard-subject'

export type DashboardLens = 'conduct' | 'grades'

export const SUBJECT_FILTER_ALL = '__ALL__'

export function isDashboardLens(value: unknown): value is DashboardLens {
  return value === 'conduct' || value === 'grades'
}

export function parseDashboardLens(value: unknown): DashboardLens {
  return value === 'grades' ? 'grades' : 'conduct'
}
