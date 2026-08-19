// =============================================================
// ClassGradeSheetDocument — 班级成绩单(打印版式)
// 某场考试的全班成绩矩阵 + 总分排名 + 科目统计。
// 纯展示组件;行数据由 grade-sheet.ts 的纯函数构建。
// =============================================================

import type { ExamDef, SubjectDef } from '@shared/types'
import { useT } from '../../i18n'
import { EXAM_TYPE_LABEL } from '../../pages/Academics/academics-shared'
import type { GradeSheetRow, SubjectStat } from './grade-sheet'

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 border border-gray-300 bg-gray-50 rounded px-3 py-2 text-center">
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-bold text-gray-900">{value}</div>
    </div>
  )
}

export interface ClassGradeSheetDocumentProps {
  exam: ExamDef
  subjects: SubjectDef[]
  rows: GradeSheetRow[]
  subjectStats: SubjectStat[]
  /** 班级显示名(传入则显示,不传显示各行 class_id) */
  classLabel?: string
  generatedAt?: Date
}

export function ClassGradeSheetDocument({
  exam,
  subjects,
  rows,
  subjectStats,
  classLabel,
  generatedAt = new Date(),
}: ClassGradeSheetDocumentProps) {
  const { t } = useT()
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')}`

  const totals = rows.map((r) => r.total).filter((v): v is number => v != null)
  const totalAvg =
    totals.length > 0
      ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10
      : null
  const totalMax = totals.length > 0 ? Math.max(...totals) : null
  const totalMin = totals.length > 0 ? Math.min(...totals) : null

  const examSubjects = subjects.filter((s) => exam.subjects.includes(s.id))
  const statBySubject = new Map(subjectStats.map((s) => [s.subjectId, s]))

  return (
    <div className="text-gray-900">
      {/* 报告头 */}
      <div className="flex items-end justify-between border-b-2 border-gray-900 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            {exam.name} — {t('print.gradeSheet.title', '成绩单')}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {classLabel ? `${classLabel} · ` : ''}
            {EXAM_TYPE_LABEL[exam.type]} · {exam.date} · {t('print.gradeSheet.semester', '学期')}:{' '}
            {exam.semester}
          </p>
        </div>
        <div className="text-right text-[10px] text-gray-500 leading-4">
          <div>
            {t('print.generatedAt', '生成日期')}: {stamp}
          </div>
          <div>Education Advisor</div>
        </div>
      </div>

      {/* 总览统计 */}
      <div className="flex gap-3 mt-5">
        <StatBox label={t('print.gradeSheet.students', '名单人数')} value={String(rows.length)} />
        <StatBox label={t('print.gradeSheet.graded', '有成绩人数')} value={String(totals.length)} />
        <StatBox
          label={t('print.gradeSheet.totalAvg', '总分平均')}
          value={totalAvg != null ? String(totalAvg) : '—'}
        />
        <StatBox
          label={t('print.gradeSheet.totalMax', '总分最高')}
          value={totalMax != null ? String(totalMax) : '—'}
        />
        <StatBox
          label={t('print.gradeSheet.totalMin', '总分最低')}
          value={totalMin != null ? String(totalMin) : '—'}
        />
      </div>

      {/* 成绩矩阵 */}
      <table className="w-full text-xs border-collapse mt-5">
        <thead>
          <tr className="bg-gray-100 text-gray-700">
            <th className="border border-gray-300 px-2 py-1.5 text-center font-medium w-[40px]">
              {t('print.gradeSheet.no', '序号')}
            </th>
            <th className="border border-gray-300 px-2 py-1.5 text-left font-medium">
              {t('print.gradeSheet.name', '姓名')}
            </th>
            {!classLabel && (
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium w-[90px]">
                {t('print.gradeSheet.class', '班级')}
              </th>
            )}
            {examSubjects.map((s) => (
              <th key={s.id} className="border border-gray-300 px-2 py-1.5 text-center font-medium">
                {s.name}
                <span className="text-[9px] text-gray-500 ml-0.5">/{s.fullMark}</span>
              </th>
            ))}
            <th className="border border-gray-300 px-2 py-1.5 text-center font-medium w-[55px]">
              {t('print.gradeSheet.total', '总分')}
            </th>
            <th className="border border-gray-300 px-2 py-1.5 text-center font-medium w-[55px]">
              {t('print.gradeSheet.rank', '排名')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name}>
              <td className="border border-gray-300 px-2 py-1 text-center text-gray-500">
                {i + 1}
              </td>
              <td className="border border-gray-300 px-2 py-1 font-medium">{r.name}</td>
              {!classLabel && (
                <td className="border border-gray-300 px-2 py-1 text-gray-600">
                  {r.classId || '—'}
                </td>
              )}
              {examSubjects.map((s) => {
                const v = r.scores[s.id]
                return (
                  <td key={s.id} className="border border-gray-300 px-2 py-1 text-center font-mono">
                    {v != null ? v : '—'}
                  </td>
                )
              })}
              <td className="border border-gray-300 px-2 py-1 text-center font-mono font-semibold">
                {r.total != null ? r.total : '—'}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-center font-mono">
                {r.rank != null ? r.rank : '—'}
              </td>
            </tr>
          ))}
          {/* 科目统计行 */}
          <tr className="bg-gray-50 font-medium">
            <td
              className="border border-gray-300 px-2 py-1.5 text-gray-700"
              colSpan={classLabel ? 2 : 3}
            >
              {t('print.gradeSheet.subjectAvg', '科目平均分')}
            </td>
            {examSubjects.map((s) => {
              const stat = statBySubject.get(s.id)
              return (
                <td key={s.id} className="border border-gray-300 px-2 py-1.5 text-center font-mono">
                  {stat?.average != null ? stat.average : '—'}
                </td>
              )
            })}
            <td className="border border-gray-300 px-2 py-1.5 text-center font-mono">
              {totalAvg != null ? totalAvg : '—'}
            </td>
            <td className="border border-gray-300 px-2 py-1.5" />
          </tr>
        </tbody>
      </table>

      {/* 页脚 */}
      <div className="mt-8 pt-3 border-t border-gray-300 flex justify-between text-[10px] text-gray-400">
        <span>
          {t('print.gradeSheet.footer', '本成绩单由 Education Advisor 在本地生成，数据不出本机')}
        </span>
        <span>
          {exam.name} · {stamp}
        </span>
      </div>
    </div>
  )
}
