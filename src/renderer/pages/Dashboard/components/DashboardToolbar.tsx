// =============================================================
// DashboardToolbar — 仪表盘页头操作区
// 班级筛选 + 视图镜头（操行优先/成绩优先）+ 考试/科目筛选 + 对比 + 刷新
// =============================================================

import type { ClassEntity, ExamDef, SubjectDef } from '@shared/types'
import { ClassFilterSelect } from '../../../components/ClassFilterSelect'
import { useT } from '../../../i18n'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { type DashboardLens, SUBJECT_FILTER_ALL } from '../dashboard-lens'

export function DashboardToolbar({
  classFilter,
  onClassFilterChange,
  activeClassList,
  compareMode,
  onCompareModeToggle,
  onRefresh,
  lens,
  onLensChange,
  exams,
  examId,
  onExamIdChange,
  subjects,
  subjectId,
  onSubjectIdChange,
}: {
  classFilter: string
  onClassFilterChange: (value: string) => void
  activeClassList: ClassEntity[]
  compareMode: boolean
  onCompareModeToggle: () => void
  onRefresh: () => void
  lens: DashboardLens
  onLensChange: (lens: DashboardLens) => void
  exams: ExamDef[]
  examId: string
  onExamIdChange: (id: string) => void
  subjects: SubjectDef[]
  subjectId: string
  onSubjectIdChange: (id: string) => void
}) {
  const { t } = useT()
  const isGrades = lens === 'grades'
  return (
    <>
      <div
        role="group"
        aria-label={t('page.dashboard.lens.aria')}
        className="inline-flex rounded-lg border border-gray-200 dark:border-white/[0.08] overflow-hidden"
      >
        <button
          type="button"
          onClick={() => onLensChange('conduct')}
          className={cn(
            btnStyle(lens === 'conduct' ? 'primary' : 'ghost'),
            'rounded-none border-0 shadow-none',
          )}
          title={t('page.dashboard.lens.conductTitle')}
          aria-pressed={lens === 'conduct'}
        >
          {t('page.dashboard.lens.conduct')}
        </button>
        <button
          type="button"
          onClick={() => onLensChange('grades')}
          className={cn(
            btnStyle(lens === 'grades' ? 'primary' : 'ghost'),
            'rounded-none border-0 shadow-none',
          )}
          title={t('page.dashboard.lens.gradesTitle')}
          aria-pressed={lens === 'grades'}
        >
          {t('page.dashboard.lens.grades')}
        </button>
      </div>
      <ClassFilterSelect
        value={classFilter}
        onChange={onClassFilterChange}
        classes={activeClassList}
        allLabel={t('page.academics.class.all', '全部班级')}
        noneLabel={t('page.classes.profile.unassigned', '未分班')}
        title={t('page.students.toolbar.filterByClass', '按班级筛选')}
      />
      {isGrades && (
        <>
          <select
            value={examId}
            onChange={(e) => onExamIdChange(e.target.value)}
            className={INPUT_SM}
            title={t('page.dashboard.academic.filter.exam')}
            aria-label={t('page.dashboard.academic.filter.exam')}
            disabled={exams.length === 0}
          >
            {exams.length === 0 ? (
              <option value="">{t('page.dashboard.academic.summary.empty')}</option>
            ) : (
              exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                  {exam.date ? ` · ${exam.date}` : ''}
                </option>
              ))
            )}
          </select>
          <select
            value={subjectId}
            onChange={(e) => onSubjectIdChange(e.target.value)}
            className={INPUT_SM}
            title={t('page.dashboard.academic.filter.subject')}
            aria-label={t('page.dashboard.academic.filter.subject')}
          >
            <option value={SUBJECT_FILTER_ALL}>
              {t('page.dashboard.academic.filter.allSubjects')}
            </option>
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>
        </>
      )}
      {!isGrades && (
        <button
          type="button"
          onClick={onCompareModeToggle}
          className={btnStyle(compareMode ? 'primary' : 'secondary')}
          title={t('page.dashboard.compareModeTitle')}
          aria-label={t('page.dashboard.compareModeTitle')}
        >
          {t('page.dashboard.compareMode')}
        </button>
      )}
      <button
        type="button"
        onClick={onRefresh}
        className={btnStyle('ghost')}
        aria-label={t('page.dashboard.ariaRefreshData')}
      >
        {t('page.dashboard.refresh')}
      </button>
    </>
  )
}
