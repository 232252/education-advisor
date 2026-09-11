// =============================================================
// GradingMarksDocument — 批阅痕迹打印文档测试
// =============================================================

import type { GradingPaper, GradingTask } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GradingMarksDocument } from '../GradingMarksDocument'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const rubric: GradingTask['rubric'] = [
  { id: 'q-1', title: '一、选择题', fullMark: 20, order: 1 },
  { id: 'q-2', title: '二、填空', fullMark: 10, order: 2 },
]

const paper: GradingPaper = {
  id: 'p1',
  studentName: '张三',
  files: [{ name: 'zhang.png', storedName: 'zhang.png', mime: 'image/png', bytes: 12 }],
  uploadedAt: '2026-09-11T00:00:00Z',
  status: 'graded',
  ai: {
    questions: [
      {
        questionId: 'q-1',
        score: 16,
        comment: '第3小题错',
        box: { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.08 },
      },
      { questionId: 'q-2', score: 10 },
    ],
    totalScore: 26,
    model: { provider: 'p', model: 'm' },
    finishedAt: '2026-09-11T01:00:00Z',
  },
  review: {
    questions: { 'q-1': { score: 15, comment: '单位漏写' } },
    overallComment: '书写工整，注意单位。',
    reviewedAt: '2026-09-11T02:00:00Z',
  },
}

const task: Pick<GradingTask, 'name' | 'semester' | 'className' | 'examDate' | 'rubric'> = {
  name: '数学周测',
  semester: '2026秋',
  className: '高一4班',
  examDate: '2026-09-11',
  rubric,
}

afterEach(() => cleanup())

describe('GradingMarksDocument', () => {
  it('展示学生、生效总分、教师评语与卷面叠字', () => {
    render(
      <GradingMarksDocument
        task={task}
        papers={[{ paper, imageUrls: [PIXEL] }]}
        generatedAt={new Date('2026-09-11T12:00:00')}
      />,
    )
    expect(screen.getByText(/数学周测/)).toBeDefined()
    expect(screen.getByText(/张三/)).toBeDefined()
    expect(screen.getByText('25/30')).toBeDefined()
    expect(screen.getAllByText(/单位漏写/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/书写工整/)).toBeDefined()
    expect(screen.getByText(/一、选择题 15\/20 单位漏写/)).toBeDefined()
  })

  it('未归组试卷显示占位名,无扫描件给空状态', () => {
    const unassigned: GradingPaper = { ...paper, studentName: null, files: [], ai: paper.ai }
    render(<GradingMarksDocument task={task} papers={[{ paper: unassigned, imageUrls: [] }]} />)
    expect(screen.getByText(/未归组/)).toBeDefined()
    expect(screen.getByText('本份试卷没有扫描件')).toBeDefined()
  })
})
