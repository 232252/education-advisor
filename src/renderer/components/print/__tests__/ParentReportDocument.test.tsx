// =============================================================
// ParentReportDocument — 家长版报告组件测试
// 验证: 友好措辞替代风险术语 / 敏感信息不出现 / 事件分组 / 成绩表
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
import { ParentReportDocument } from '../ParentReportDocument'

function mkEvent(
  id: string,
  type: 'ConductBonus' | 'ConductDeduct',
  timestamp: string,
  note: string,
  reverted = false,
): EAAHistoryEvent {
  return {
    event_id: id,
    timestamp,
    event_type: type,
    reason_code: 'R01',
    score_delta: type === 'ConductBonus' ? 2 : -2,
    cumulative: 80,
    note,
    tags: [],
    reverted,
  }
}

const SCORE: EAAStudentScore = {
  name: '张三',
  entity_id: 'e1',
  score: 82.5,
  delta: 3.2,
  risk: '中',
  risk_stored: '中',
  status: 'Active',
  events_count: 12,
  last_event_at: '2026-01-05T10:00:00Z',
  groups: [],
  roles: [],
  class_id: 'G7-3',
}

const PROFILE: StudentProfileData = {
  parentName: '李四',
  idCard: '110101201001011234',
  phone: '13812345678',
  parentPhone: '13987654321',
}

const EXAMS: ExamDef[] = [
  {
    id: 'exam1',
    name: '期中考试',
    type: 'midterm',
    date: '2026-04-20',
    semester: '2026春',
    subjects: ['sub1', 'sub2'],
    createdAt: '2026-04-21T00:00:00Z',
  },
]

const GRADES: GradeRecord[] = [
  {
    examId: 'exam1',
    subjectId: 'sub1',
    studentName: '张三',
    score: 92,
    fullMark: 100,
    updatedAt: '2026-04-21T00:00:00Z',
  },
  {
    examId: 'exam1',
    subjectId: 'sub2',
    studentName: '张三',
    score: null,
    fullMark: 100,
    updatedAt: '2026-04-21T00:00:00Z',
  },
]

const SUBJECTS: SubjectDef[] = [
  { id: 'sub1', name: '语文', category: 'core', fullMark: 100, isCore: true },
  { id: 'sub2', name: '数学', category: 'core', fullMark: 100, isCore: true },
]

function renderDoc(overrides?: Partial<Parameters<typeof ParentReportDocument>[0]>) {
  return render(
    <ParentReportDocument
      studentName="张三"
      classId="G7-3"
      score={SCORE}
      profileData={PROFILE}
      events={[
        mkEvent('b1', 'ConductBonus', '2026-01-02T10:00:00Z', '帮助同学补习功课'),
        mkEvent('d1', 'ConductDeduct', '2026-01-03T10:00:00Z', '上课迟到一次'),
        mkEvent('d2', 'ConductDeduct', '2026-01-04T10:00:00Z', '已撤销的记录', true),
      ]}
      grades={GRADES}
      exams={EXAMS}
      subjects={SUBJECTS}
      {...overrides}
    />,
  )
}

afterEach(() => cleanup())

describe('ParentReportDocument — 措辞与隐私', () => {
  it('标题与家长称呼', () => {
    renderDoc()
    expect(screen.getByText('家校沟通报告')).toBeDefined()
    expect(screen.getByText(/李四家长/)).toBeDefined()
  })

  it('风险等级被转译为友好措辞,不出现"风险"或等级原文', () => {
    const { container } = renderDoc()
    expect(container.textContent).toContain('总体良好，偶有起伏')
    expect(container.textContent).not.toContain('风险')
    // 内部分值不直接呈现
    expect(container.textContent).not.toContain('82.5')
  })

  it('敏感信息(身份证/手机号)不出现在报告中', () => {
    const { container } = renderDoc()
    expect(container.textContent).not.toContain('110101201001011234')
    expect(container.textContent).not.toContain('13812345678')
    expect(container.textContent).not.toContain('13987654321')
  })
})

describe('ParentReportDocument — 事件分组', () => {
  it('亮点与关注点分组展示,撤销事件不出现', () => {
    renderDoc()
    expect(screen.getByText('帮助同学补习功课')).toBeDefined()
    expect(screen.getByText('上课迟到一次')).toBeDefined()
    expect(screen.queryByText('已撤销的记录')).toBeNull()
  })

  it('无事件时显示空状态文案', () => {
    renderDoc({ events: [] })
    expect(screen.getByText('本阶段暂无特别记录，欢迎家长多与孩子交流在校生活。')).toBeDefined()
    expect(screen.getByText('目前没有需要特别关注的方面，请家长放心。')).toBeDefined()
  })
})

describe('ParentReportDocument — 学业成绩', () => {
  it('成绩表含科目/分数/满分,缺考显示占位', () => {
    renderDoc()
    expect(screen.getByText(/期中考试/)).toBeDefined()
    expect(screen.getByText('语文')).toBeDefined()
    expect(screen.getByText('数学')).toBeDefined()
    expect(screen.getByText('92')).toBeDefined()
    expect(screen.getByText('缺考')).toBeDefined()
    expect(screen.getAllByText('100').length).toBeGreaterThanOrEqual(2)
  })

  it('无成绩时显示空状态', () => {
    renderDoc({ grades: [], exams: [] })
    expect(screen.getByText('暂无近期考试成绩记录。')).toBeDefined()
  })
})

describe('ParentReportDocument — 概况卡', () => {
  it('趋势上升显示"稳步上升"', () => {
    renderDoc({ score: { ...SCORE, delta: 5 } })
    expect(screen.getByText('稳步上升')).toBeDefined()
  })

  it('趋势下降显示"略有起伏"', () => {
    renderDoc({ score: { ...SCORE, delta: -1 } })
    expect(screen.getByText('略有起伏')).toBeDefined()
  })

  it('score 为 null 时占位', () => {
    renderDoc({ score: null })
    const { container } = renderDoc({ score: null })
    expect(container.textContent).toContain('—')
  })

  it('参与记录数来自 events_count', () => {
    renderDoc({ score: { ...SCORE, events_count: 12 } })
    expect(screen.getByText(/12 条/)).toBeDefined()
  })
})
