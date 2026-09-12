// =============================================================
// classRank auto-assign — competition ranking (1,2,2,4)
// Used by academic-service on batchSetGrades so Academics entry
// and ClassGrades analytics share one rule.
//
// Rule (documented):
// - Group records by (examId, subjectId).
// - If a group has ≥2 distinct students with numeric scores,
//   ALWAYS recompute classRank by score desc (ties share rank;
//   next rank skips — competition ranking). Hand-filled ranks
//   in that group are overwritten.
// - If a group has only 1 student with a numeric score, leave
//   classRank untouched (avoids all-subjects single-student saves
//   wiping real class ranks with "1").
// - Null scores: classRank cleared (undefined).
// =============================================================

export interface RankableGrade {
  examId: string
  subjectId: string
  studentName: string
  score: number | null
  classRank?: number
}

function groupKey(examId: string, subjectId: string): string {
  return `${examId}\0${subjectId}`
}

/**
 * Competition ranks for a score list: higher score → better (lower) rank.
 * Equal scores share the same rank; the next distinct score skips ahead
 * (e.g. 100,95,95,90 → ranks 1,2,2,4).
 */
export function competitionRanksByScoreDesc(scores: number[]): number[] {
  const indexed = scores.map((score, i) => ({ score, i }))
  indexed.sort((a, b) => b.score - a.score)
  const ranks = new Array<number>(scores.length)
  let prevScore: number | null = null
  let prevRank = 0
  indexed.forEach((item, order) => {
    if (prevScore != null && item.score === prevScore) {
      ranks[item.i] = prevRank
    } else {
      const rank = order + 1
      ranks[item.i] = rank
      prevRank = rank
      prevScore = item.score
    }
  })
  return ranks
}

/**
 * Apply auto classRank to a batch of grade records (immutable: returns new array).
 * See file header for the full rule.
 */
export function applyAutoClassRanks<T extends RankableGrade>(records: T[]): T[] {
  if (records.length === 0) return records

  const groups = new Map<string, number[]>()
  records.forEach((r, i) => {
    const k = groupKey(r.examId, r.subjectId)
    const arr = groups.get(k)
    if (arr) arr.push(i)
    else groups.set(k, [i])
  })

  const out = records.map((r) => ({ ...r }))

  for (const indices of groups.values()) {
    const scoredIdx = indices.filter((i) => out[i].score != null && Number.isFinite(out[i].score))
    // Clear rank on absent / null-score rows in this group
    for (const i of indices) {
      if (out[i].score == null || !Number.isFinite(out[i].score as number)) {
        const next = { ...out[i] }
        delete next.classRank
        out[i] = next
      }
    }
    const distinctStudents = new Set(scoredIdx.map((i) => out[i].studentName))
    if (distinctStudents.size < 2) {
      // Single-student subject group: preserve existing / hand-filled ranks
      continue
    }
    const scores = scoredIdx.map((i) => out[i].score as number)
    const ranks = competitionRanksByScoreDesc(scores)
    scoredIdx.forEach((recIdx, j) => {
      out[recIdx] = { ...out[recIdx], classRank: ranks[j] }
    })
  }

  return out
}
