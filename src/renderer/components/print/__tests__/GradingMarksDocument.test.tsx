// =============================================================
// GradingMarksDocument — 批阅痕迹打印文档测试(痕迹卷/批阅报告两模式)
// =============================================================

import type { GradingPaper, GradingTask } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GradingMarksDocument } from '../GradingMarksDocument'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const rubric: GradingTask['rubric'] = [
  { id: 'q-1', title: '一、选择题', fullMark: 20, order: 1 },
  { id: 'q-2', title: '四、简答题', fullMark: 10, order: 2 },
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
        deductions: [{ points: 4, reason: '第3小题计算错误' }],
        box: { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.08 },
      },
      {
        questionId: 'q-2',
        score: 6,
        comment: '要点缺一步',
        deductions: [
          { points: 2, reason: '受力分析缺失' },
          { points: 2, reason: '单位未换算' },
        ],
        box: { page: 0, x: 0.1, y: 0.5, w: 0.3, h: 0.08 },
      },
    ],
    totalScore: 22,
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

/** 打印正文里不应出现红框(红框仅屏幕复核用) */
function redFrameCount(): number {
  return document.querySelectorAll('[class*="border-red-600"]').length
}

afterEach(() => cleanup())

describe('GradingMarksDocument — 痕迹卷(默认模式)', () => {
  it('原卷落红笔痕迹: 得分/✓ 用手写体,无红框无得分表,卷尾一行防混卷', () => {
    const { container } = render(
      <GradingMarksDocument
        task={task}
        papers={[{ paper, imageUrls: [PIXEL] }]}
        generatedAt={new Date('2026-09-11T12:00:00')}
      />,
    )
    // 生效分 15+6: 两题均部分对 → 卷面红笔得分
    expect(screen.getByText('15/20')).toBeDefined()
    expect(screen.getByText('6/10')).toBeDefined()
    // 手写体类落在痕迹上
    expect(container.querySelectorAll('.handwriting-mark').length).toBeGreaterThan(0)
    // 红框与角标底框不进打印;无得分表/页眉
    expect(redFrameCount()).toBe(0)
    expect(screen.queryByText(/批阅痕迹/)).toBeNull()
    expect(screen.queryByText(/题号/)).toBeNull()
    // 防混卷小字: 学生名 · 生效总分
    expect(screen.getByText(/张三 · 21\/30/)).toBeDefined()
  })

  it('全对打✓ 零分打✗,主观题页边批注按对应位置展示', () => {
    const ai = paper.ai
    expect(ai).toBeDefined()
    if (!ai) return
    const [choice, shortAnswer] = ai.questions
    expect(choice).toBeDefined()
    expect(shortAnswer).toBeDefined()
    if (!choice || !shortAnswer) return
    const fullMarkPaper: GradingPaper = {
      ...paper,
      ai: {
        ...ai,
        questions: [
          { ...choice, score: 20 },
          { ...shortAnswer, score: 0, comment: '未作答' },
        ],
      },
      review: undefined,
    }
    const { container } = render(
      <GradingMarksDocument task={task} papers={[{ paper: fullMarkPaper, imageUrls: [PIXEL] }]} />,
    )
    expect(screen.getByText('✓')).toBeDefined()
    expect(screen.getByText('✗')).toBeDefined()
    // 客观题全对无批注;主观题零分批注进页边栏
    expect(container.textContent).toContain('未作答')
  })
})

describe('GradingMarksDocument — 批阅报告模式', () => {
  it('展示学生、生效总分、逐题得分表与总评,卷面同样不画红框', () => {
    render(
      <GradingMarksDocument
        task={task}
        papers={[{ paper, imageUrls: [PIXEL] }]}
        mode="report"
        generatedAt={new Date('2026-09-11T12:00:00')}
      />,
    )
    expect(screen.getByText(/数学周测/)).toBeDefined()
    expect(screen.getByText(/张三/)).toBeDefined()
    expect(screen.getByText('21/30')).toBeDefined()
    expect(screen.getByText(/书写工整/)).toBeDefined()
    // 客观题评语在得分表;主观题评语额外进页边批注
    expect(screen.getAllByText(/单位漏写/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/要点缺一步/).length).toBe(2)
    expect(redFrameCount()).toBe(0)
  })

  it('扣分说明进报告得分表(红字)与页边批注', () => {
    const { container } = render(
      <GradingMarksDocument
        task={task}
        papers={[{ paper, imageUrls: [PIXEL] }]}
        mode="report"
        generatedAt={new Date('2026-09-11T12:00:00')}
      />,
    )
    // 得分表红字扣分行: 两题各一条,扣分点以「·」连接
    const redDeduct = container.querySelectorAll('span.text-red-600')
    const redText = [...redDeduct].map((el) => el.textContent).join('\n')
    expect(redText).toContain('-4 第3小题计算错误')
    expect(redText).toContain('-2 受力分析缺失')
    expect(redText).toContain('-2 单位未换算')
    // 主观题(q-2)页边批注同样带扣分点
    const marginNotes = container.querySelectorAll('.handwriting-mark')
    const noteText = [...marginNotes].map((el) => el.textContent).join('\n')
    expect(noteText).toContain('-2 受力分析缺失')
  })

  it('未归组试卷显示占位名,无扫描件给空状态', () => {
    const unassigned: GradingPaper = { ...paper, studentName: null, files: [], ai: paper.ai }
    render(
      <GradingMarksDocument
        task={task}
        papers={[{ paper: unassigned, imageUrls: [] }]}
        mode="report"
      />,
    )
    expect(screen.getByText(/未归组/)).toBeDefined()
    expect(screen.getByText('本份试卷没有扫描件')).toBeDefined()
  })
})
