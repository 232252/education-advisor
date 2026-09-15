// =============================================================
// xiaoyi/auth — AK/SK HMAC headers (QwenPaw xiaoyi/auth.py)
// =============================================================

import { createHmac } from 'node:crypto'

/** Base64(HMAC-SHA256(secretKey, timestamp_ms_string)) */
export function generateSignature(sk: string, timestamp: string): string {
  return createHmac('sha256', sk).update(timestamp, 'utf8').digest('base64')
}

export function generateAuthHeaders(
  ak: string,
  sk: string,
  agentId: string,
  nowMs = Date.now(),
): Record<string, string> {
  const timestamp = String(nowMs)
  const signature = generateSignature(sk, timestamp)
  return {
    'x-access-key': ak,
    'x-sign': signature,
    'x-ts': timestamp,
    'x-agent-id': agentId,
  }
}
