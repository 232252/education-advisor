// =============================================================
// Summary Export 测试 — 成绩汇总 CSV(纯函数 buildSummaryCsv)
// 覆盖: \uFEFF BOM / 列结构 / 逐题与总分 effectiveQuestionScore 同口径
//       (教师覆盖优先) / skipped 卷不进学生行 / 统计块(平均/最高/最低
//       /中位数+分数段人数) / RFC 4180 转义。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { GradingPaper, GradingTask } from '../../src/shared/types'
import { buildSummaryCsv, medianOf } from '../../src/main/services/grading/summary-export'

const RUBRIC = [
  { id: 'q-1', title: '选择题', fullMark: 30, order: 1 },
  { id: 'q-2', title: '计算题', fullMark: 20, order: 2 },
]

function paperOf(
  id: string,
  studentName: string | null,
  scores: Array<number | null>,
  opts?: { overallComment?: string; review?: GradingPaper['review'] },
): GradingPaper {
  return {
    id,
    studentName,
    files: [],
    uploadedAt: '2026-01-01T00:00:00Z',
    status: 'graded',
    ai: {
      questions: scores
        .map((s, i) => (s === null ? null : { questionId: `q-${i + 1}`, score: s }))
        .filter((q): q is { questionId: string; score: number } => q !== null),
      totalScore: scores.reduce((sum, s) => sum + (s ?? 0), 0),
      model: { provider: 'p', model: 'm' },
      finishedAt: '2026-01-01T00:00:00Z',
    },
    ...(opts?.review ? { review: opts.review } : {}),
  }
}

function taskOf(papers: GradingPaper[]): GradingTask {
  return {
    id: 't-1',
    name: '九班专题一',
    semester: '2026 上',
    status: 'review',
    rubric: RUBRIC,
    papers,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('buildSummaryCsv — 结构与口径', () => {
  const task = taskOf([
    paperOf('p-1', '张三', [28, 15], {
      review: { questions: {}, overallComment: '进步明显，注意验算', reviewedAt: '' },
    }),
    paperOf('p-2', '李四', [30, 20]),
    // 覆盖优先: q-1 教师改 25
    paperOf('p-3', '王五', [28, 18], {
      review: { questions: { 'q-1': { score: 25 } }, reviewedAt: '' },
    }),
  ])
  const csv = buildSummaryCsv(task)

  it('utf-8-sig: \\uFEFF 开头; 表头 = 序号|姓名|逐题|总分|缺题数|批语', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const firstLine = csv.split('\r\n')[0] ?? ''
    expect(firstLine).toBe('\uFEFF序号,姓名,1.选择题,2.计算题,总分,缺题数,批语')
  })

  it('逐题/总分与 effectiveQuestionScore 同口径(教师覆盖优先);序号连续', () => {
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('1,张三,28,15,43,0,进步明显，注意验算')
    expect(lines[2]).toBe('2,李四,30,20,50,0,')
    expect(lines[3]).toBe('3,王五,25,18,43,0,') // q-1 覆盖 25 生效
  })

  it('统计块: 共 N 人 + 平均/最高/最低/中位数 + 分数段人数(互斥)', () => {
    const stat = csv.split('\r\n').filter((l) => l.length > 0)
    expect(stat).toContain('统计,共 3 人')
    expect(stat).toContain('平均分,45.33') // (43+50+43)/3
    expect(stat).toContain('最高分,50')
    expect(stat).toContain('最低分,43')
    expect(stat).toContain('中位数,43')
    // 满分 50: 50/50=100% 优秀;43/50=86% 良好 ×2
    expect(stat).toContain('优秀(≥90%),1')
    expect(stat).toContain('良好(80%~90%),2')
    expect(stat).toContain('中等(70%~80%),0')
    expect(stat).toContain('及格(60%~70%),0')
    expect(stat).toContain('不及格(<60%),0')
  })

  it('skipped 卷不进学生行: 未归组/未批改/分数不完整都不出现', () => {
    const withSkipped = taskOf([
      paperOf('p-1', '张三', [28, 15]),
      paperOf('p-2', null, [30, 20]), // 未归组
      { ...paperOf('p-3', '李四', [30, 20]), ai: undefined, status: 'pending' }, // 未批改
      paperOf('p-4', '王五', [30, null]), // 分数不完整(q-2 缺)
      paperOf('p-5', '张三', [10, 10]), // 同学生第二份 → 跳过
    ])
    const lines = buildSummaryCsv(withSkipped).split('\r\n')
    expect(lines[1]).toBe('1,张三,28,15,43,0,')
    expect(lines[3]).toContain('统计') // lines[2] 是隔开统计块的空行
    expect(lines.some((l) => l.startsWith('2,'))).toBe(false)
    expect(lines.some((l) => l.includes('王五'))).toBe(false)
    expect(lines.some((l) => l.includes('李四'))).toBe(false)
    expect(lines).toContain('统计,共 1 人')
  })

  it('批语含逗号/引号时 RFC 4180 转义;分数 round 到 2 位', () => {
    const withComma = taskOf([
      paperOf('p-1', '张三', [28.333333, 15], {
        review: { questions: {}, overallComment: '认真,但"粗心"', reviewedAt: '' },
      }),
    ])
    const lines = buildSummaryCsv(withComma).split('\r\n')
    expect(lines[1]).toBe('1,张三,28.33,15,43.33,0,"认真,但""粗心"""')
  })
})

describe('medianOf', () => {
  it('奇数取中间;偶数取中间两数均值;空 → null', () => {
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([1, 2, 3, 4])).toBe(2.5)
    expect(medianOf([10])).toBe(10)
    expect(medianOf([])).toBeNull()
  })
})
