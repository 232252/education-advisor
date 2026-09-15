// =============================================================
// _shared/reconnect — QwenPaw-parity exponential backoff helpers
// =============================================================

export const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const

export interface BackoffState {
  attempts: number
  delaysMs: readonly number[]
  maxAttempts: number
}

export function createBackoffState(opts?: {
  delaysMs?: readonly number[]
  maxAttempts?: number
}): BackoffState {
  return {
    attempts: 0,
    delaysMs: opts?.delaysMs ?? DEFAULT_RECONNECT_DELAYS_MS,
    maxAttempts: opts?.maxAttempts ?? 50,
  }
}

/** Next delay in ms; null if max attempts exhausted. */
export function nextBackoffDelay(state: BackoffState): number | null {
  if (state.attempts >= state.maxAttempts) return null
  const idx = Math.min(state.attempts, state.delaysMs.length - 1)
  state.attempts += 1
  return state.delaysMs[idx] ?? 60_000
}

export function resetBackoff(state: BackoffState): void {
  state.attempts = 0
}

/** Schedule a one-shot reconnect; returns cancel handle. */
export function scheduleReconnect(
  state: BackoffState,
  fn: () => void | Promise<void>,
  onExhausted?: () => void,
): { cancel: () => void; delayMs: number | null } {
  const delayMs = nextBackoffDelay(state)
  if (delayMs == null) {
    onExhausted?.()
    return { cancel: () => undefined, delayMs: null }
  }
  const timer = setTimeout(() => {
    void Promise.resolve(fn()).catch(() => undefined)
  }, delayMs)
  return {
    delayMs,
    cancel: () => clearTimeout(timer),
  }
}
