// =============================================================
// Grading Summary Export — 成绩汇总 CSV(纯函数 builder)
// 口径:
//   - 学生行只收录"有归属学生 + 有 AI 结果 + 量规口径总分完整 + 同学生
//     首份"的试卷——与 publishTask 的 skipped 门径一致,跳过的卷不进
//     学生行(不以部分和冒充总分);
//   - 逐题分与总分走 grading-helpers 的 effectiveQuestionScore /
//     effectiveTotalScoreForRubric(教师覆盖优先),与发布同口径;
//   - utf-8-sig(\uFEFF 开头,Excel 双击直开不乱码);字段含逗号/引号/
//     换行时按 RFC 4180 双引号转义;
//   - 末尾统计块: 平均/最高/最低/中位数 + 按满分比例的分数段人数。
// 写盘由 grading-handlers 的 export-summary-csv handler 完成(路径来自
// 渲染层保存对话框),本模块不碰 IO。
// =============================================================

import {
  effectiveQuestionScore,
  effectiveTotalScoreForRubric,
  rubricFullMark,
} from '@shared/grading-helpers'
import type { GradingTask } from '@shared/types'

/** CSV 字段转义: 含逗号/引号/换行的字段用双引号包裹(RFC 4180) */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtScore(n: number): number {
  return Math.round(n * 100) / 100
}

/** 中位数: 奇数取中间,偶数取中间两数均值(round 2 位) */
export function medianOf(scores: number[]): number | null {
  if (scores.length === 0) return null
  const sorted = [...scores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const midVal = sorted[mid]
  if (midVal === undefined) return null
  if (sorted.length % 2 === 1) return midVal
  const below = sorted[mid - 1]
  return below === undefined ? midVal : fmtScore((below + midVal) / 2)
}

/** 分数段(按总分/满分比例): [label, minRatio, maxRatio) 递减排列 */
const SCORE_BANDS: Array<{ label: string; min: number }> = [
  { label: '优秀(≥90%)', min: 0.9 },
  { label: '良好(80%~90%)', min: 0.8 },
  { label: '中等(70%~80%)', min: 0.7 },
  { label: '及格(60%~70%)', min: 0.6 },
  { label: '不及格(<60%)', min: Number.NEGATIVE_INFINITY },
]

/**
 * 构造成绩汇总 CSV 全文(含 \uFEFF BOM,utf-8 直写即 utf-8-sig)。
 * 纯函数: 同一 task 输出确定。
 */
export function buildSummaryCsv(task: GradingTask): string {
  const rubric = task.rubric
  const fullMarkTotal = rubricFullMark(rubric)
  const header = [
    '序号',
    '姓名',
    ...rubric.map((q, i) => `${i + 1}.${q.title}`),
    '总分',
    '缺题数',
    '批语',
  ]

  const rows: string[] = []
  const totals: number[] = []
  const seen = new Set<string>()
  for (const paper of task.papers) {
    if (paper.studentName === null || !paper.ai || seen.has(paper.studentName)) continue
    const total = effectiveTotalScoreForRubric(paper, rubric)
    if (total === null) continue // 分数不完整(缺题未补覆盖) → 与发布同门径跳过
    seen.add(paper.studentName)
    totals.push(total)
    const perQuestion = rubric.map((q) => {
      const s = effectiveQuestionScore(paper, q.id)
      return s === null ? '' : fmtScore(s)
    })
    const missing = rubric.filter((q) => effectiveQuestionScore(paper, q.id) === null).length
    rows.push(
      [
        rows.length + 1,
        paper.studentName,
        ...perQuestion,
        fmtScore(total),
        missing,
        (paper.review?.overallComment ?? '').trim(),
      ]
        .map(csvCell)
        .join(','),
    )
  }

  const avg = totals.length > 0 ? fmtScore(totals.reduce((s, n) => s + n, 0) / totals.length) : null
  const max = totals.length > 0 ? fmtScore(Math.max(...totals)) : null
  const min = totals.length > 0 ? fmtScore(Math.min(...totals)) : null
  const median = medianOf(totals)

  const lines: string[] = [`\uFEFF${header.map(csvCell).join(',')}`, ...rows]
  // 统计块(空一行隔开;分数段按总分/满分比例,满分合计为 0 时不分档)
  lines.push('')
  lines.push([csvCell('统计'), csvCell(`共 ${totals.length} 人`)].join(','))
  lines.push([csvCell('平均分'), csvCell(avg ?? '')].join(','))
  lines.push([csvCell('最高分'), csvCell(max ?? '')].join(','))
  lines.push([csvCell('最低分'), csvCell(min ?? '')].join(','))
  lines.push([csvCell('中位数'), csvCell(median ?? '')].join(','))
  if (fullMarkTotal > 0) {
    lines.push([csvCell('分数段'), csvCell('人数')].join(','))
    for (const [i, band] of SCORE_BANDS.entries()) {
      // 各段互斥: [band.min, 上一段的 min);最后一段到 0
      const upper = i === 0 ? Number.POSITIVE_INFINITY : (SCORE_BANDS[i - 1]?.min ?? 1)
      const n = totals.filter((s) => {
        const ratio = s / fullMarkTotal
        return ratio >= band.min && ratio < upper
      }).length
      lines.push([csvCell(band.label), csvCell(n)].join(','))
    }
  }
  return `${lines.join('\r\n')}\r\n`
}
