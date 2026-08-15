// =============================================================
// console 劫持与初始化 — initLogger
//
// 职责:
//   - 从 settings.logLevel 读取级别 + 劫持 console
//   - EPIPE 抑制(子进程管道断裂防护)
//   - 诊断日志写入(验证文件系统访问)
//
// 避免重复 initLogger 时层层包裹(double-wrap)导致每条日志被重复写入多次。
// 实现: 给我们的 wrapper 打标签(固定字符串 key,跨模块重载可识别)并保存原始引用,
// 再次 initLogger 时先取回原始(未包裹)的 console method 再重新包裹,保证始终只有一层。
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, writeLine } from './file-transport'
import { fmt, stringify } from './format'
import { type LogLevel, levelState, shouldLog } from './levels'
import { loggerState } from './state'

const LOGGER_ORIG_KEY = '__loggerOrigFn'
type TaggedFn = ((...args: unknown[]) => void) & {
  [LOGGER_ORIG_KEY]?: (...args: unknown[]) => void
}

function getBuiltin(fn: (...args: unknown[]) => void): (...args: unknown[]) => void {
  const tagged = fn as TaggedFn
  // 如果已被我们包裹,取回它委托的原始函数
  return tagged[LOGGER_ORIG_KEY] ?? fn.bind(console)
}

export function initLogger(level: LogLevel, dir?: string): void {
  levelState.currentLevel = level
  if (dir) loggerState.logsDir = dir
  ensureDir()
  // DIAGNOSTIC: synchronous write to verify file system access
  try {
    fs.writeFileSync(
      path.join(loggerState.logsDir, 'init-diagnostic.log'),
      `[${new Date().toISOString()}] initLogger called, level=${level}, logsDir=${loggerState.logsDir}\n`,
      { flag: 'a' },
    )
  } catch {
    // If this fails, we need to know
  }
  // Suppress EPIPE errors on stdout/stderr. When running as a subprocess with a
  // broken pipe, writes to stdout emit async 'error' events that become uncaught
  // exceptions. Adding a no-op 'error' listener prevents this.
  try {
    process.stdout?.on?.('error', () => {})
  } catch {
    /* ignore */
  }
  try {
    process.stderr?.on?.('error', () => {})
  } catch {
    /* ignore */
  }
  // Bug fix: console.log is a separate function reference from console.info in Node.js.
  // Previously only console.info/warn/error/debug were wrapped, so all console.log calls
  // throughout the codebase bypassed the file logger entirely. Now wrap console.log too.
  const origLog = getBuiltin(console.log as (...args: unknown[]) => void)
  const origDebug = getBuiltin(console.debug as (...args: unknown[]) => void)
  const origInfo = getBuiltin(console.info as (...args: unknown[]) => void)
  const origWarn = getBuiltin(console.warn as (...args: unknown[]) => void)
  const origError = getBuiltin(console.error as (...args: unknown[]) => void)

  const wrap = (
    orig: (...args: unknown[]) => void,
    lvl: LogLevel,
  ): ((...args: unknown[]) => void) => {
    const wrapper: (...args: unknown[]) => void = (...args: unknown[]) => {
      // Write to file FIRST, then call orig (stdout). If stdout pipe is broken
      // (EPIPE when running as a subprocess), orig() throws and the file write
      // would be skipped. By writing to file first, logs are always persisted.
      // orig() is wrapped in try-catch to prevent uncaught EPIPE exceptions.
      if (shouldLog(lvl)) void writeLine('main', fmt(lvl, 'console', args.map(stringify).join(' ')))
      try {
        orig(...args)
      } catch {
        /* EPIPE or other stdout errors — file write already happened */
      }
    }
    ;(wrapper as TaggedFn)[LOGGER_ORIG_KEY] = orig
    return wrapper
  }

  console.log = wrap(origLog, 'info')
  console.debug = wrap(origDebug, 'debug')
  console.info = wrap(origInfo, 'info')
  console.warn = wrap(origWarn, 'warn')
  console.error = wrap(origError, 'error')
}
