// =============================================================
// Class grade movement — improved / declined / flat from two-exam deltas
// =============================================================

/** Count students by totalScoreDelta sign. Null deltas are ignored. */
export function summarizeScoreMovement(
  comps: Array<{ totalScoreDelta: number | null }>,
): { improved: number; declined: number; flat: number } {
  let improved = 0
  let declined = 0
  let flat = 0
  for (const s of comps) {
    if (s.totalScoreDelta === null) continue
    if (s.totalScoreDelta > 0) improved++
    else if (s.totalScoreDelta < 0) declined++
    else flat++
  }
  return { improved, declined, flat }
}
