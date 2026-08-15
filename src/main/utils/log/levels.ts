// =============================================================
// 日志级别控制 — LogLevel 定义 / 级别比较 / 运行时切换
//
// 5 档:debug / info / warn / error / off
// 支持运行时 setLogLevel(被 settings-handlers 触发)
// =============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: 99,
}

/**
 * 当前级别状态(模块级单例,可变对象共享给各子模块)。
 * 初始 'info',由 initLogger / setLogLevel 修改。
 */
export const levelState: { currentLevel: LogLevel } = { currentLevel: 'info' }

export function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[levelState.currentLevel]
}

/** 运行时切换 level */
export function setLogLevel(level: LogLevel): void {
  levelState.currentLevel = level
}

export function getLogLevel(): LogLevel {
  return levelState.currentLevel
}
