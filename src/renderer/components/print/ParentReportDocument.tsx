// =============================================================
// ParentReportDocument — 家长版报告(打印版式)
// 与综合报告的区别: 面向家长措辞温和、不含身份证/联系电话、
// 不呈现内部风险术语与累计扣分,突出表现亮点/关注点/家校配合建议。
// 纯展示组件,只使用浅色显式样式,任何主题下打印输出一致。
// =============================================================

import type {
  EAAHistoryEvent,
  EAAStudentScore,
  ExamDef,
  GradeRecord,
  StudentProfileData,
  SubjectDef,
} from '@shared/types'
import { useT } from '../../i18n'
import { riskToParentTerm, splitEventsForParent } from '../../pages/Students/lib/home-school'

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="text-[13px] font-bold text-gray-900 border-l-[3px] border-emerald-600 pl-2 mt-6 mb-3">
      {children}
    </h2>
  )
}

export interface ParentReportDocumentProps {
  studentName: string
  classId?: string | null
  score: EAAStudentScore | null
  profileData: StudentProfileData
  events: EAAHistoryEvent[]
  grades: GradeRecord[]
  exams: ExamDef[]
  subjects: SubjectDef[]
  generatedAt?: Date
}

export function ParentReportDocument({
  studentName,
  classId,
  score,
  profileData,
  events,
  grades,
  exams,
  subjects,
  generatedAt = new Date(),
}: ParentReportDocumentProps) {
  const { t } = useT()
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')}`

  const { highlights, concerns } = splitEventsForParent(events)

  // 学业: 最近 2 次考试的科目成绩
  const examById = new Map(exams.map((e) => [e.id, e]))
  const gradesByExam = new Map<string, GradeRecord[]>()
  for (const g of grades) {
    const list = gradesByExam.get(g.examId) ?? []
    list.push(g)
    gradesByExam.set(g.examId, list)
  }
  const recentExams = [...gradesByExam.entries()]
    .map(([examId, list]) => ({ exam: examById.get(examId), records: list }))
    .filter((r): r is { exam: ExamDef; records: GradeRecord[] } => r.exam != null)
    .sort((a, b) => (b.exam.date || '').localeCompare(a.exam.date || ''))
    .slice(0, 2)

  const subjectNames = new Map(subjects.map((s) => [s.id, s.name ?? s.id]))

  // 家长称呼
  const parentSalutation = profileData.parentName?.trim()
    ? `${profileData.parentName.trim()}家长`
    : t('print.parentReport.dearParent', '尊敬的家长')

  return (
    <div className="text-gray-900">
      {/* 报告头 */}
      <div className="flex items-end justify-between border-b-2 border-gray-900 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-wide">
            {t('print.parentReport.title', '家校沟通报告')}
          </h1>
          <p className="text-sm font-semibold text-gray-800 mt-1.5">{studentName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('print.parentReport.subtitle', '孩子的近期表现与家校配合建议')}
          </p>
        </div>
        <div className="text-right text-[10px] text-gray-500 leading-4">
          <div>
            {t('print.generatedAt', '生成日期')}: {stamp}
          </div>
          {classId && <div>{classId}</div>}
        </div>
      </div>

      {/* 致家长 */}
      <p className="text-xs text-gray-600 leading-6 mt-4">
        {parentSalutation}
        {t(
          'print.parentReport.greeting',
          '，您好！感谢您一直以来对孩子教育的支持与配合。以下是孩子近期的在校表现情况，供您了解，也期待家校携手，共同陪伴孩子成长。',
        )}
      </p>

      {/* 学生概况 */}
      <SectionTitle>{t('print.parentReport.basicTitle', '孩子概况')}</SectionTitle>
      <div className="flex gap-3">
        <div className="flex-1 border border-gray-300 rounded px-3 py-2 text-center bg-gray-50">
          <div className="text-[10px] text-gray-500 mb-0.5">
            {t('print.parentReport.conductLevel', '在校表现')}
          </div>
          <div className="text-base font-bold text-gray-900">
            {score ? riskToParentTerm(score.risk) : '—'}
          </div>
        </div>
        <div className="flex-1 border border-gray-300 rounded px-3 py-2 text-center bg-gray-50">
          <div className="text-[10px] text-gray-500 mb-0.5">
            {t('print.parentReport.recentTrend', '近期趋势')}
          </div>
          <div className="text-base font-bold text-gray-900">
            {score == null
              ? '—'
              : score.delta > 0
                ? t('print.parentReport.trendUp', '稳步上升')
                : score.delta < 0
                  ? t('print.parentReport.trendDown', '略有起伏')
                  : t('print.parentReport.trendFlat', '保持稳定')}
          </div>
        </div>
        <div className="flex-1 border border-gray-300 rounded px-3 py-2 text-center bg-gray-50">
          <div className="text-[10px] text-gray-500 mb-0.5">
            {t('print.parentReport.activityCount', '参与记录')}
          </div>
          <div className="text-base font-bold text-gray-900">
            {score?.events_count ?? 0} {t('print.parentReport.recordsUnit', '条')}
          </div>
        </div>
      </div>

      {/* 表现亮点 */}
      <SectionTitle>{t('print.parentReport.highlightsTitle', '近期亮点')}</SectionTitle>
      {highlights.length === 0 ? (
        <p className="text-xs text-gray-500 leading-6">
          {t(
            'print.parentReport.highlightsEmpty',
            '本阶段暂无特别记录，欢迎家长多与孩子交流在校生活。',
          )}
        </p>
      ) : (
        <ul className="space-y-1">
          {highlights.map((e) => (
            <li key={e.event_id} className="flex text-xs leading-6">
              <span className="text-gray-500 w-20 flex-shrink-0">{fmtDate(e.timestamp)}</span>
              <span className="text-gray-800">{e.note || e.reason_code}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 需要关注 */}
      <SectionTitle>{t('print.parentReport.concernsTitle', '需要关注的方面')}</SectionTitle>
      {concerns.length === 0 ? (
        <p className="text-xs text-gray-500 leading-6">
          {t('print.parentReport.concernsEmpty', '目前没有需要特别关注的方面，请家长放心。')}
        </p>
      ) : (
        <ul className="space-y-1">
          {concerns.map((e) => (
            <li key={e.event_id} className="flex text-xs leading-6">
              <span className="text-gray-500 w-20 flex-shrink-0">{fmtDate(e.timestamp)}</span>
              <span className="text-gray-800">{e.note || e.reason_code}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 学业成绩 */}
      <SectionTitle>{t('print.parentReport.academicsTitle', '近期学业成绩')}</SectionTitle>
      {recentExams.length === 0 ? (
        <p className="text-xs text-gray-500 leading-6">
          {t('print.parentReport.academicsEmpty', '暂无近期考试成绩记录。')}
        </p>
      ) : (
        recentExams.map(({ exam, records }) => (
          <div key={exam.id} className="mb-3">
            <div className="text-[11px] font-semibold text-gray-700 mb-1">
              {exam.name}
              {exam.date ? `(${fmtDate(exam.date)})` : ''}
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1 text-left font-medium">
                    {t('print.parentReport.subject', '科目')}
                  </th>
                  <th className="border border-gray-300 px-2 py-1 text-right font-medium w-20">
                    {t('print.parentReport.score', '分数')}
                  </th>
                  <th className="border border-gray-300 px-2 py-1 text-right font-medium w-20">
                    {t('print.parentReport.fullScore', '满分')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((g) => (
                  <tr key={`${g.examId}-${g.subjectId}`}>
                    <td className="border border-gray-300 px-2 py-1">
                      {subjectNames.get(g.subjectId) ?? g.subjectId}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono">
                      {g.score ?? t('print.parentReport.absent', '缺考')}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right font-mono text-gray-500">
                      {g.fullMark}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* 家校配合建议 */}
      <SectionTitle>{t('print.parentReport.suggestionsTitle', '家校配合建议')}</SectionTitle>
      <ul className="text-xs text-gray-800 leading-7 list-disc pl-5">
        <li>
          {t(
            'print.parentReport.suggestion1',
            '每天抽出 10-15 分钟与孩子聊聊在校生活，倾听比说教更有效。',
          )}
        </li>
        <li>
          {t('print.parentReport.suggestion2', '对亮点表现请及时给予肯定，巩固孩子的积极行为。')}
        </li>
        <li>
          {t(
            'print.parentReport.suggestion3',
            '对需要关注的方面，请与老师保持沟通，家校口径一致、共同引导。',
          )}
        </li>
      </ul>

      {/* 落款 */}
      <div className="mt-10 text-right text-xs text-gray-600 leading-6">
        <div>{t('print.parentReport.signoff', '班主任')}</div>
        <div>{stamp}</div>
      </div>
    </div>
  )
}
