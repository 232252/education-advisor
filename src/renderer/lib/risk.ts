/**
 * 风险等级工具函数
 * 单点定义，避免 StudentProfile.tsx 和 StudentsPage.tsx 各维护一份
 */
export type RiskLevel = '低' | '中' | '高' | '极高'

/** 风险等级 → Tailwind 颜色类 */
export function riskColor(risk: string): string {
  switch (risk) {
    case '低':
      return 'text-green-500 dark:text-green-400'
    case '中':
      return 'text-yellow-500 dark:text-yellow-400'
    case '高':
      return 'text-orange-500 dark:text-orange-400'
    case '极高':
      return 'text-red-500 dark:text-red-400 font-bold'
    default:
      return 'text-gray-500'
  }
}

/** 风险等级排序权重（用于列表排序） */
export const riskOrder: Record<string, number> = {
  '低': 0,
  '中': 1,
  '高': 2,
  '极高': 3,
}

/** 获取排序值（含未知兜底） */
export function riskSortValue(risk: string): number {
  return riskOrder[risk] ?? -1
}