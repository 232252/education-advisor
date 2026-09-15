// =============================================================
// adapters/weixin/persist — cursor + context_token 落盘(可恢复长轮询/弱主动)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { log } from '../../../../utils/logger'

export interface WeixinPersistState {
  cursor: string
  contextByUser: Record<string, string>
}

function safeReadJson(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function loadWeixinPersist(stateDir: string): WeixinPersistState {
  const cursorFile = path.join(stateDir, 'cursor.txt')
  const ctxFile = path.join(stateDir, 'context_tokens.json')
  let cursor = ''
  try {
    if (fs.existsSync(cursorFile)) cursor = fs.readFileSync(cursorFile, 'utf8').trim()
  } catch {
    /* ignore */
  }
  const raw = safeReadJson(ctxFile)
  const contextByUser: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && v) contextByUser[k] = v
    }
  }
  return { cursor, contextByUser }
}

export function saveWeixinCursor(stateDir: string, cursor: string): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, 'cursor.txt'), cursor ?? '', 'utf8')
  } catch (err) {
    log('debug', 'weixin', `save cursor failed: ${err instanceof Error ? err.message : err}`)
  }
}

export function saveWeixinContextTokens(stateDir: string, map: Map<string, string>): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    const obj: Record<string, string> = {}
    for (const [k, v] of map) obj[k] = v
    fs.writeFileSync(
      path.join(stateDir, 'context_tokens.json'),
      JSON.stringify(obj, null, 0),
      'utf8',
    )
  } catch (err) {
    log(
      'debug',
      'weixin',
      `save context_tokens failed: ${err instanceof Error ? err.message : err}`,
    )
  }
}
