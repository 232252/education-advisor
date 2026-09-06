// =============================================================
// 学业默认配置 — 科目集与考试类型(主进程种子 / 渲染端兜底共用)
// 主进程 academic-service 首次生成 config.json 时以此为种子,
// 渲染端在 config 缺失时以此为兜底。此前两侧各存一份且考试
// 类型标签不一致,现统一以主进程种子口径为准(单一来源)。
// =============================================================

import type { ExamType, SubjectDef } from './types'

/** 默认科目集 — 覆盖全部 10 个科目 */
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
  { value: 'midterm', label: '期中考试' },
  { value: 'final', label: '期末考试' },
  { value: 'quiz', label: '小测' },
  { value: 'test', label: '单元测试' },
  { value: 'mock', label: '模拟考试' },
  { value: 'other', label: '其他' },
]
