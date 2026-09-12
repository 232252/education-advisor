import { describe, expect, it } from 'vitest'
import type {
  AcademicStatsSummary,
  StudentGradeRow,
} from '../../../Dashboard/dashboard-academic-stats'
import { buildClassGradesAiPrompt, pickClassGradesAiAgentId } from '../class-grades-ai-prompt'

const stats: AcademicStatsSummary = {
  examCount: 3,
  studentCount: 40,
  recordedCount: 38,
  recordedLabel: '38/40',
  avgPct: 72.5,
  absentCount: 2,
  lowCount: 5,
}

const row = (
  name: string,
  displayScore: number | null,
  status: StudentGradeRow['status'] = 'ok',
): StudentGradeRow => ({
  name,
  entityId: name,
  displayScore,
  pct: displayScore,
  kind: 'percent',
  status,
})

describe('buildClassGradesAiPrompt', () => {
  it('includes class/exam aggregates and caps lists', () => {
    const ranked = Array.from({ length: 8 }, (_, i) => row(`S${i}`, 90 - i))
    const watch = [row('W1', 40), row('W2', null, 'absent')]
    const prompt = buildClassGradesAiPrompt({
      classLabel: '高一(3)班',
      examName: '月考一',
      examDate: '2026-09-01',
      subjectLabel: '全部科目',
      stats,
      avgLabel: '72.5%',
      ranked,
      watchlist: watch,
      movement: { improved: 10, declined: 8, flat: 20 },
      examAName: '月考一',
      examBName: '月考二',
      movers: [
        { studentName: 'A', totalScoreDelta: 12 },
        { studentName: 'B', totalScoreDelta: -9 },
        { studentName: 'C', totalScoreDelta: 5 },
      ],
    })
    expect(prompt).toContain('高一(3)班')
    expect(prompt).toContain('月考一（2026-09-01）')
    expect(prompt).toContain('已录人数: 38')
    expect(prompt).toContain('进步: 10 人')
    expect(prompt).toContain('S0')
    expect(prompt).not.toContain('S5') // top capped at 5 → S0..S4
    expect(prompt).toContain('W1')
    expect(prompt).toContain('eaa_exam_grades')
    expect(prompt).not.toContain('完整花名册成绩表以外的禁止词测试')
  })

  it('works without movement block', () => {
    const prompt = buildClassGradesAiPrompt({
      examName: '期末',
      subjectLabel: '数学',
      stats,
      avgLabel: '80',
      ranked: [],
      watchlist: [],
    })
    expect(prompt).toContain('期末')
    expect(prompt).not.toContain('两场升降摘要')
  })
})

describe('pickClassGradesAiAgentId', () => {
  it('prefers academic when enabled', () => {
    expect(
      pickClassGradesAiAgentId([
        { id: 'class-monitor', enabled: true },
        { id: 'academic', enabled: true },
      ]),
    ).toBe('academic')
  })

  it('falls back to first enabled', () => {
    expect(
      pickClassGradesAiAgentId([
        { id: 'data-analyst', enabled: true },
        { id: 'academic', enabled: false },
      ]),
    ).toBe('data-analyst')
  })

  it('returns null when none enabled', () => {
    expect(pickClassGradesAiAgentId([{ id: 'academic', enabled: false }])).toBeNull()
  })
})
