// =============================================================
// StudentReportDocument — 学生综合报告(打印版式)
// 纯展示组件,数据全部由调用方传入;只使用浅色显式样式,
// 不含 dark: 变体,保证任何主题下打印输出一致。
// 隐私: 身份证/手机号在报告中部分脱敏。
// =============================================================

import type {
  EAAHistoryEvent,
  EAAStudentScore,
  ExamDef,
  GradeRecord,
  StudentProfileData,
  SubjectDef,
} from '@shared/types'
import type { ReactNode } from 'react'
import { useT } from '../../i18n'

/** 手机号脱敏: 保留前3后4 */
function maskPhone(phone?: string): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** 身份证脱敏: 保留前4后3 */
function maskIdCard(id?: string): string {
  if (!id) return '—'
  if (id.length < 8) return id
  return `${id.slice(0, 4)}***********${id.slice(-3)}`
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

// ─── 通用小件(仅打印域使用,显式浅色) ───

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[13px] font-bold text-gray-900 border-l-[3px] border-blue-600 pl-2 mt-6 mb-3">
      {children}
    </h2>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex text-xs leading-6">
      <span className="text-gray-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`flex-1 border rounded px-3 py-2 text-center ${accent ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
    >
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-bold text-gray-900">{value}</div>
    </div>
  )
}

export interface StudentReportDocumentProps {
  studentName: string
  classId?: string | null
  score: EAAStudentScore | null
  profileData: StudentProfileData
  events: EAAHistoryEvent[]
  grades: GradeRecord[]
  exams: ExamDef[]
  subjects: SubjectDef[]
  /** 报告展示的最近事件条数上限 */
  recentEventLimit?: number
  generatedAt?: Date
}

export function StudentReportDocument({
  studentName,
  classId,
  score,
  profileData,
  events,
  grades,
  exams,
  subjects,
  recentEventLimit = 20,
  generatedAt = new Date(),
}: StudentReportDocumentProps) {
  const { t } = useT()
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')}`

  // 近期事件: 有效的优先,按时间倒序,截取上限
  const recentEvents = [...events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, recentEventLimit)

  // 成绩: 按考试日期倒序
  const examById = new Map(exams.map((e) => [e.id, e]))
  const gradesByExam = new Map<string, GradeRecord[]>()
  for (const g of grades) {
    const list = gradesByExam.get(g.examId) ?? []
    list.push(g)
    gradesByExam.set(g.examId, list)
  }
  const examRows = [...gradesByExam.entries()]
    .map(([examId, list]) => ({ exam: examById.get(examId), records: list }))
    .filter((r): r is { exam: ExamDef; records: GradeRecord[] } => r.exam != null)
    .sort((a, b) => (b.exam.date || '').localeCompare(a.exam.date || ''))

  return (
    <div className="text-gray-900">
      {/* 报告头 */}
      <div className="flex items-end justify-between border-b-2 border-gray-900 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            {t('print.studentReport.title', '学生综合报告')}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {t('print.studentReport.subtitle', '操行表现与学业成绩汇总')}
          </p>
        </div>
        <div className="text-right text-[10px] text-gray-500 leading-4">
          <div>
            {t('print.generatedAt', '生成日期')}: {stamp}
          </div>
          <div>Education Advisor</div>
        </div>
      </div>

      {/* 一、基本信息 */}
      <SectionTitle>{t('print.studentReport.basicInfo', '基本信息')}</SectionTitle>
      <div className="grid grid-cols-2 gap-x-10">
        <InfoItem label={t('print.studentReport.name', '姓名')} value={studentName} />
        <InfoItem label={t('print.studentReport.class', '班级')} value={classId || '—'} />
        <InfoItem
          label={t('print.studentReport.gender', '性别')}
          value={profileData.gender || '—'}
        />
        <InfoItem
          label={t('print.studentReport.birthDate', '出生日期')}
          value={profileData.birthDate || '—'}
        />
        <InfoItem
          label={t('print.studentReport.parent', '家长')}
          value={profileData.parentName || '—'}
        />
        <InfoItem
          label={t('print.studentReport.parentPhone', '家长电话')}
          value={maskPhone(profileData.parentPhone)}
        />
        <InfoItem
          label={t('print.studentReport.idCard', '身份证号')}
          value={maskIdCard(profileData.idCard)}
        />
        <InfoItem
          label={t('print.studentReport.enrollment', '入学日期')}
          value={profileData.enrollmentDate || '—'}
        />
      </div>

      {/* 二、操行分概览 */}
      <SectionTitle>{t('print.studentReport.conduct', '操行分概览')}</SectionTitle>
      <div className="flex gap-3">
        <StatBox
          label={t('print.studentReport.currentScore', '当前分数')}
          value={score ? String(score.score) : '—'}
          accent
        />
        <StatBox
          label={t('print.studentReport.riskLevel', '风险等级')}
          value={score?.risk ?? '—'}
        />
        <StatBox
          label={t('print.studentReport.scoreChange', '近期变化')}
          value={score ? `${score.delta >= 0 ? '+' : ''}${score.delta}` : '—'}
        />
        <StatBox
          label={t('print.studentReport.eventCount', '事件总数')}
          value={score ? String(score.events_count) : String(events.length)}
        />
      </div>

      {/* 三、近期操行事件 */}
      <SectionTitle>
        {t('print.studentReport.recentEvents', '近期操行事件')}
        {recentEvents.length > 0 && (
          <span className="text-[10px] font-normal text-gray-500 ml-2">
            ({t('print.studentReport.latest', '最近')} {recentEvents.length}{' '}
            {t('print.studentReport.items', '条')})
          </span>
        )}
      </SectionTitle>
      {recentEvents.length === 0 ? (
        <p className="text-xs text-gray-400">{t('print.studentReport.noEvents', '暂无事件记录')}</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium w-[90px]">
                {t('print.studentReport.date', '日期')}
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium w-[70px]">
                {t('print.studentReport.type', '类型')}
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium">
                {t('print.studentReport.reason', '原因')}
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-right font-medium w-[60px]">
                {t('print.studentReport.delta', '分数变化')}
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium">
                {t('print.studentReport.note', '备注')}
              </th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.map((e) => (
              <tr key={e.event_id}>
                <td className="border border-gray-300 px-2 py-1 text-gray-600">
                  {fmtDate(e.timestamp)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-gray-600">
                  {e.event_type === 'ConductBonus'
                    ? t('print.studentReport.bonus', '加分')
                    : t('print.studentReport.deduct', '扣分')}
                </td>
                <td className="border border-gray-300 px-2 py-1">
                  <span className="text-gray-800">{e.reason_code}</span>
                  {e.reverted && (
                    <span className="ml-1 text-[10px] text-gray-400">
                      ({t('print.studentReport.reverted', '已撤销')})
                    </span>
                  )}
                </td>
                <td
                  className={`border border-gray-300 px-2 py-1 text-right font-mono ${
                    e.score_delta >= 0 ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {e.score_delta >= 0 ? '+' : ''}
                  {e.score_delta}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-gray-600">{e.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 四、学业成绩 */}
      <SectionTitle>{t('print.studentReport.grades', '学业成绩')}</SectionTitle>
      {examRows.length === 0 ? (
        <p className="text-xs text-gray-400">{t('print.studentReport.noGrades', '暂无成绩记录')}</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium">
                {t('print.studentReport.exam', '考试')}
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left font-medium w-[85px]">
                {t('print.studentReport.examDate', '日期')}
              </th>
              {subjects.map((s) => (
                <th
                  key={s.id}
                  className="border border-gray-300 px-2 py-1.5 text-center font-medium"
                >
                  {s.name}
                </th>
              ))}
              <th className="border border-gray-300 px-2 py-1.5 text-center font-medium w-[60px]">
                {t('print.studentReport.classRank', '班级排名')}
              </th>
            </tr>
          </thead>
          <tbody>
            {examRows.map(({ exam, records }) => {
              const bySubject = new Map(records.map((r) => [r.subjectId, r]))
              const firstRank = records.find((r) => r.classRank != null)?.classRank
              return (
                <tr key={exam.id}>
                  <td className="border border-gray-300 px-2 py-1 font-medium">{exam.name}</td>
                  <td className="border border-gray-300 px-2 py-1 text-gray-600">{exam.date}</td>
                  {subjects.map((s) => {
                    const g = bySubject.get(s.id)
                    return (
                      <td
                        key={s.id}
                        className="border border-gray-300 px-2 py-1 text-center font-mono"
                      >
                        {g?.score != null ? g.score : '—'}
                      </td>
                    )
                  })}
                  <td className="border border-gray-300 px-2 py-1 text-center font-mono">
                    {firstRank ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* 页脚 */}
      <div className="mt-8 pt-3 border-t border-gray-300 flex justify-between text-[10px] text-gray-400">
        <span>
          {t('print.studentReport.footer', '本报告由 Education Advisor 在本地生成，数据不出本机')}
        </span>
        <span>
          {studentName} · {stamp}
        </span>
      </div>
    </div>
  )
}
