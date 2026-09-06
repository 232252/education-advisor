// =============================================================
// 打印文档通用原语 — StatBox / SectionTitle / fmtDate
// Student/Parent/ClassGradeSheet 三份打印文档共用的小件,
// 显式浅色(打印不走暗色主题),单一来源防样式漂移。
// =============================================================

import type { ExamDef, GradeRecord } from '@shared/types'
import type { ReactNode } from 'react'

/** 统计小格:标签 + 加粗数值,accent 时蓝色高亮 */
export function StatBox({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      className={`flex-1 border rounded px-3 py-2 text-center ${accent ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
    >
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-bold text-gray-900">{value}</div>
    </div>
  )
}

/** 章节标题:左侧色条 + 加粗小标题;accent 对应各报告的品牌色 */
export function SectionTitle({
  children,
  accent = 'blue',
}: {
  children: ReactNode
  accent?: 'blue' | 'emerald'
}) {
  const borderClass = accent === 'emerald' ? 'border-emerald-600' : 'border-blue-600'
  return (
    <h2
      className={`text-[13px] font-bold text-gray-900 border-l-[3px] ${borderClass} pl-2 mt-6 mb-3`}
    >
      {children}
    </h2>
  )
}

/** ISO 日期取 YYYY-MM-DD(打印列表用) */
export function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

// =============================================================
// 文档级原语 — 文件名戳 / 按考试分组成行
// (此前在 Student/Parent/ClassGradeSheet 各有一份逐字副本)
// =============================================================

/**
 * [R2-21 豁免] 打印文件名戳用本地时区 ISO 日期(YYYY-MM-DD),
 * 与展示用 formatDate(截取 ISO 字符串)语义不同,勿合并。
 */
export function printStamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 按考试分组的成绩行(考试日期倒序;limit 截取最近 N 场) */
export function examGradeRows(
  grades: GradeRecord[],
  exams: ExamDef[],
  limit?: number,
): Array<{ exam: ExamDef; records: GradeRecord[] }> {
  const examById = new Map(exams.map((e) => [e.id, e]))
  const gradesByExam = new Map<string, GradeRecord[]>()
  for (const g of grades) {
    const list = gradesByExam.get(g.examId) ?? []
    list.push(g)
    gradesByExam.set(g.examId, list)
  }
  const rows = [...gradesByExam.entries()]
    .map(([examId, records]) => ({ exam: examById.get(examId), records }))
    .filter((r): r is { exam: ExamDef; records: GradeRecord[] } => r.exam != null)
    .sort((a, b) => (b.exam.date || '').localeCompare(a.exam.date || ''))
  return limit === undefined ? rows : rows.slice(0, limit)
}
