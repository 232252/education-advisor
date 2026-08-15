// =============================================================
// 学业页面默认配置 — config 缺失时的兜底科目集与考试类型
// (仅 AcademicsPage 使用; 导出以便常量与组件文件分离)
// =============================================================

import type { ExamType, SubjectDef } from '@shared/types'

/** 默认科目集 (config 缺失时使用) — 覆盖全部 10 个科目 */
export const DEFAULT_SUBJECTS: SubjectDef[] = [
  { id: 'chinese', name: '语文', category: 'core', fullMark: 150, isCore: true },
  { id: 'math', name: '数学', category: 'core', fullMark: 150, isCore: true },
  { id: 'english', name: '英语', category: 'core', fullMark: 150, isCore: true },
  { id: 'physics', name: '物理', category: 'science', fullMark: 100 },
  { id: 'chemistry', name: '化学', category: 'science', fullMark: 100 },
  { id: 'biology', name: '生物', category: 'science', fullMark: 100 },
  { id: 'politics', name: '政治', category: 'arts', fullMark: 100 },
  { id: 'history', name: '历史', category: 'arts', fullMark: 100 },
  { id: 'geography', name: '地理', category: 'arts', fullMark: 100 },
  { id: 'pe', name: '体育', category: 'pe', fullMark: 100 },
]

/** 默认考试类型 — 与 ExamType 一一对应 */
export const DEFAULT_EXAM_TYPES: Array<{ value: ExamType; label: string }> = [
  { value: 'monthly', label: '月考' },
  { value: 'midterm', label: '期中' },
  { value: 'final', label: '期末' },
  { value: 'test', label: '平时测试' },
  { value: 'quiz', label: '随堂测验' },
  { value: 'mock', label: '模拟考试' },
  { value: 'other', label: '其他' },
]
