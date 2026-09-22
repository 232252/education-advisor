// =============================================================
// 班级-考试归属纯函数
// 班级成绩页自动选考试时优先「本班考试」,避免打开 9 班却落在
// 别班同名考试上(全班无成绩,看起来像"成绩不见了")。
// =============================================================

import type { ExamDef, GradeRecord } from '@shared/types'
import { sortByDateDesc } from '../../../lib/academics'

/** 考试下拉的「全部考试」哨兵值(汇总本班学生在所有考试的成绩) */
export const EXAM_FILTER_ALL = '__ALL_EXAMS__'

/** 多场考试的班级成绩按学生合并(同名 concat,供「全部考试」聚合口径) */
export function mergeClassGrades(
  parts: Array<Record<string, GradeRecord[]>>,
): Record<string, GradeRecord[]> {
  const out: Record<string, GradeRecord[]> = {}
  for (const part of parts) {
    for (const [name, records] of Object.entries(part)) {
      if (!records || records.length === 0) continue
      if (!out[name]) out[name] = []
      out[name].push(...records)
    }
  }
  return out
}

/**
 * 班内自动选考试:
 * 1. 有本班考试(classId 优先,历史考试回落 scope)→ 取日期最近的一场;
 * 2. 没有归属信息/全部不匹配 → 回落全局最近一场(保持旧行为)。
 */
export function pickClassExamId(exams: ExamDef[], classId?: string | null): string {
  const sorted = sortByDateDesc(exams)
  if (!classId || sorted.length === 0) return sorted[0]?.id ?? ''
  const inClass = sorted.filter((e) => (e.classId ?? e.scope ?? '') === classId)
  return (inClass[0] ?? sorted[0])?.id ?? ''
}

/** 考试是否明确归属其他班级(仅认显式 classId;scope 兼容全年级/批改等非班级口径,不标记) */
export function isForeignClassExam(exam: ExamDef, classId?: string | null): boolean {
  if (!classId || !exam.classId) return false
  return exam.classId !== classId
}
