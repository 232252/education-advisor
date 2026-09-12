// =============================================================
// summarizeScoreMovement — improved / declined / flat counts
// =============================================================

import { describe, expect, it } from 'vitest'
import { summarizeScoreMovement } from '../grade-movement'

describe('summarizeScoreMovement', () => {
  it('counts improved, declined, and flat; skips null', () => {
    expect(
      summarizeScoreMovement([
        { totalScoreDelta: 3.5 },
        { totalScoreDelta: -1 },
        { totalScoreDelta: 0 },
        { totalScoreDelta: null },
        { totalScoreDelta: 12 },
      ]),
    ).toEqual({ improved: 2, declined: 1, flat: 1 })
  })

  it('returns zeros for an empty list', () => {
    expect(summarizeScoreMovement([])).toEqual({ improved: 0, declined: 0, flat: 0 })
  })
})
