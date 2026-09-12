// =============================================================
// buildClassGradesAiPrompt — aggregate (non-export) class context
// for academic agent. Names already visible in ranking/watchlist
// UI; never dumps full per-subject grade matrices.
// =============================================================

import type {
  AcademicStatsSummary,
  StudentGradeRow,
} from '../../Dashboard/dashboard-academic-stats'

export interface ClassGradesAiPromptInput {
  classLabel?: string
  examName: string
  examDate?: string
  subjectLabel: string
  stats: AcademicStatsSummary
  avgLabel: string
  /** Already ranked (high → low); only first N used */
  ranked: StudentGradeRow[]
  watchlist: StudentGradeRow[]
  movement?: { improved: number; declined: number; flat: number }
  examAName?: string
  examBName?: string
  /** Optional movers with totalScoreDelta; top/bottom by delta */
  movers?: Array<{ studentName: string; totalScoreDelta: number | null }>
}

const TOP_N = 5
const WATCH_N = 5
const MOVER_N = 3

function formatScoreRow(r: StudentGradeRow): string {
  const score = r.displayScore == null ? '—' : String(r.displayScore)
  const status = r.status === 'ok' ? '' : ` (${r.status})`
  return `- ${r.name}: ${score}${status}`
}

function pickMovers(
  movers: Array<{ studentName: string; totalScoreDelta: number | null }>,
  direction: 'up' | 'down',
): string[] {
  const scored = movers.filter((m) => m.totalScoreDelta != null) as Array<{
    studentName: string
    totalScoreDelta: number
  }>
  const sorted =
    direction === 'up'
      ? [...scored].sort((a, b) => b.totalScoreDelta - a.totalScoreDelta)
      : [...scored].sort((a, b) => a.totalScoreDelta - b.totalScoreDelta)
  return sorted
    .filter((m) => (direction === 'up' ? m.totalScoreDelta > 0 : m.totalScoreDelta < 0))
    .slice(0, MOVER_N)
    .map((m) => `- ${m.studentName}: ${m.totalScoreDelta > 0 ? '+' : ''}${m.totalScoreDelta}`)
}

/**
 * Build a teacher-facing class grades analysis prompt for the academic agent.
 * Prefer tool verification (eaa_exams / eaa_exam_grades) over trusting these aggregates alone.
 */
export function buildClassGradesAiPrompt(input: ClassGradesAiPromptInput): string {
  const className = input.classLabel?.trim() || '(未命名班级)'
  const examLine = input.examDate ? `${input.examName}（${input.examDate}）` : input.examName

  const top = input.ranked.slice(0, TOP_N).map(formatScoreRow)
  const watch = input.watchlist.slice(0, WATCH_N).map(formatScoreRow)

  const lines: Array<string | null> = [
    '你是班主任的学业分析助手。请基于以下「本班成绩摘要」做班级层面分析，并可用工具核对数据。',
    '',
    '## 班级与考试',
    `- 班级: ${className}`,
    `- 考试: ${examLine}`,
    `- 科目范围: ${input.subjectLabel}`,
    '',
    '## 摘要统计（界面已算，请优先用工具复核）',
    `- 班级人数: ${input.stats.studentCount}`,
    `- 已录人数: ${input.stats.recordedCount}（${input.stats.recordedLabel}）`,
    `- 均分展示: ${input.avgLabel}`,
    `- 百分制均分: ${input.stats.avgPct.toFixed(1)}%`,
    `- 低分人数（<60%）: ${input.stats.lowCount}`,
    `- 缺考/未录: ${input.stats.absentCount}`,
    '',
    '## 前列学生（最多 5 名，姓名已在排行 UI 可见）',
    top.length > 0 ? top.join('\n') : '- （暂无）',
    '',
    '## 待关注（不及格/缺考/未录，最多 5 名）',
    watch.length > 0 ? watch.join('\n') : '- （暂无）',
  ]

  if (input.movement && input.examAName && input.examBName) {
    lines.push(
      '',
      '## 两场升降摘要',
      `- 基准场: ${input.examAName}`,
      `- 对比场: ${input.examBName}`,
      `- 进步: ${input.movement.improved} 人`,
      `- 退步: ${input.movement.declined} 人`,
      `- 持平: ${input.movement.flat} 人`,
    )
    if (input.movers && input.movers.length > 0) {
      const up = pickMovers(input.movers, 'up')
      const down = pickMovers(input.movers, 'down')
      lines.push('', '### 进步靠前（最多 3）', up.length ? up.join('\n') : '- （暂无）')
      lines.push('', '### 退步靠前（最多 3）', down.length ? down.join('\n') : '- （暂无）')
    }
  }

  lines.push(
    '',
    '## 请输出',
    '1. **班级概况**（2–4 句，结论先行）',
    '2. **优势与风险**（分点；风险需可核对的数字）',
    '3. **重点关注名单建议**（基于待关注/退步，说明理由；勿臆造未给出的学生）',
    '4. **可执行建议**（班主任可落地的 3 条内）',
    '',
    '约束：不要编造未提供的分数；需要明细时调用 eaa_exams / eaa_exam_grades 等工具；不要输出完整花名册成绩表。',
  )

  return lines.filter((l) => l !== null).join('\n')
}

/** Prefer academic agent when enabled */
export function pickClassGradesAiAgentId(
  agents: Array<{ id: string; enabled: boolean }>,
): string | null {
  const enabled = agents.filter((a) => a.enabled)
  if (enabled.length === 0) return null
  return enabled.find((a) => a.id === 'academic')?.id ?? enabled[0].id
}
