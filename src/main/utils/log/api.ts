// =============================================================
// 日志公开写入 API — log / logChat / logRenderer
// =============================================================

import { writeLine } from './file-transport'
import { fmt, stringify } from './format'
import { type LogLevel, levelState, shouldLog } from './levels'

/** 写一条 main 日志 */
export function log(level: LogLevel, scope: string, msg: string): void {
  if (!shouldLog(level)) return
  void writeLine('main', fmt(level, scope, msg))
}

/** 写 chat 流事件(独立文件) */
export function logChat(direction: 'in' | 'out' | 'event', payload: unknown): void {
  if (levelState.currentLevel === 'off') return
  void writeLine('chat', fmt('info', `chat-${direction}`, stringify(payload)))
}

/** 写渲染进程转发过来的日志 */
export function logRenderer(level: LogLevel, msg: string): void {
  if (!shouldLog(level)) return
  void writeLine('renderer', fmt(level, 'renderer', msg))
}
