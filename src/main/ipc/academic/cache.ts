// =============================================================
// Academic 读取结果 TTL 缓存 — R136 优化
// 模块级单例,config/exam/grade 各域 handler 共享
// =============================================================

import type { AcademicConfig, ExamDef, GradeRecord } from '@shared/types'
import { TtlLruCache } from '../../services/eaa-cache'

/**
 * R136 优化: Academic 读取结果 TTL 缓存
 * - getConfig / listExams / getGrades / getClassGrades 在 UI 频繁触发
 *   (页面切换、Tab 重渲染、EAA 同步轮询都会反复读取相同数据)
 * - 写操作(createExam / deleteExam / batchSetGrades)
 *   主动失效对应条目,保证一致性
 * - TTL 5s: 短到用户感知不到滞后, 又能挡住 1 秒内多次重复读取
 */
export const academicCache = {
  config: new TtlLruCache<AcademicConfig>({ ttlMs: 5_000, maxEntries: 4 }),
  exams: new TtlLruCache<ExamDef[]>({ ttlMs: 5_000, maxEntries: 16 }),
  grades: new TtlLruCache<GradeRecord[]>({ ttlMs: 5_000, maxEntries: 256 }),
  classGrades: new TtlLruCache<Record<string, GradeRecord[]>>({
    ttlMs: 5_000,
    maxEntries: 64,
  }),
}

/** 写操作后清掉相关缓存条目 */
export function invalidateOnExamsWrite(): void {
  academicCache.exams.clear()
  // deleteExam 会级联删除成绩, 保守起见同时清空成绩缓存
  academicCache.grades.clear()
  academicCache.classGrades.clear()
}

export function invalidateOnGradesWrite(studentNames: string[]): void {
  for (const name of studentNames) {
    academicCache.grades.delete(name)
  }
  // 班级成绩缓存 key 是 (names + examId + subjectId) 复合,
  // 受影响学生可能出现在任意班级组合里, 直接全清(容量 64, 成本可控)
  academicCache.classGrades.clear()
}
