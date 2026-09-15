// =============================================================
// xiaoyi/constants — dual-WS A2A endpoints (QwenPaw xiaoyi)
// =============================================================

export const DEFAULT_WS_URL = 'wss://hag.cloud.huawei.com/openclaw/v1/ws/link'
export const DEFAULT_WS_URL_BACKUP = 'wss://116.63.174.231/openclaw/v1/ws/link'

export const HEARTBEAT_INTERVAL_MS = 30_000
export const CONNECTION_TIMEOUT_MS = 30_000
export const DEFAULT_TASK_TIMEOUT_MS = 3_600_000
export const TEXT_CHUNK_LIMIT = 4000

export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const
export const MAX_RECONNECT_ATTEMPTS = 50
