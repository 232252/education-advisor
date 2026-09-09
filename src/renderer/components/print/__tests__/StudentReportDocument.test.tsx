// =============================================================
// StudentReportDocument — 学生综合报告组件测试
// 验证: 固定科目矩阵成绩表 / ai-grading 考试不进矩阵(科目映射不上会整行「—」)
// =============================================================

import type {
  EAAHistoryEvent,
  EAAStudentScore,
  ExamDef,
  GradeRecord,
  StudentProfileData,
  SubjectDef,
} from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StudentReportDocument } from '../StudentReportDocument'

const SCORE: EAAStudentScore = {
  name: '张三',
  entity_id: 'e1',
  score: 82.5,
  delta: 3.2,
  risk: '中',
  risk_stored: '中',
  status: 'Active',
  events_count: 3,
  last_event_at: '2026-01-05T10:00:00Z',
  groups: [],
  roles: [],
  class_id: 'G7-3',
}

const PROFILE: StudentProfileData = {}

const EXAMS: ExamDef[] = [
  {
    id: 'exam-normal',
    name: '期中考试',
    type: 'midterm',
    date: '2026-04-20',
    semester: '2026春',
    subjects: ['sub1'],
    createdAt: '2026-04-21T00:00:00Z',
  },
  {
    id: 'exam-ai',
    name: 'E2E批改得分链',
    type: 'other',
    date: '2026-09-08',
    semester: '2026-2027-1',
    scope: 'ai-grading',
    subjects: ['q1', 'q2'],
    createdAt: '2026-09-08T00:00:00Z',
  },
]

const GRADES: GradeRecord[] = [
  {
    examId: 'exam-normal',
    subjectId: 'sub1',
    studentName: '张三',
    score: 92,
    fullMark: 100,
    updatedAt: '2026-04-21T00:00:00Z',
  },
  // ai-grading 考试的科目是题目名,不在固定科目表里
  {
    examId: 'exam-ai',
    subjectId: 'q1',
    studentName: '张三',
    score: 20,
    fullMark: 20,
    updatedAt: '2026-09-08T00:00:00Z',
  },
]

const SUBJECTS: SubjectDef[] = [
  { id: 'sub1', name: '语文', category: 'core', fullMark: 100, isCore: true },
]

function renderDoc(overrides?: Partial<Parameters<typeof StudentReportDocument>[0]>) {
  return render(
    <StudentReportDocument
      studentName="张三"
      classId="G7-3"
      score={SCORE}
      profileData={PROFILE}
      events={[] as EAAHistoryEvent[]}
      grades={GRADES}
      exams={EXAMS}
      subjects={SUBJECTS}
      {...overrides}
    />,
  )
}

afterEach(() => cleanup())

describe('StudentReportDocument — 学业成绩表', () => {
  it('普通考试进固定科目矩阵', () => {
    renderDoc()
    expect(screen.getByText(/期中考试/)).toBeDefined()
    expect(screen.getByText('92')).toBeDefined()
  })

  it('ai-grading 考试科目映射不上固定矩阵,不再渲染为整行「—」', () => {
    const { container } = renderDoc()
    expect(container.textContent).not.toContain('E2E批改得分链')
  })

  it('仅有 ai-grading 考试时显示空状态', () => {
    renderDoc({ grades: GRADES.filter((g) => g.examId !== 'exam-normal'), exams: [EXAMS[1]] })
    expect(screen.getByText('暂无成绩记录')).toBeDefined()
  })
})
