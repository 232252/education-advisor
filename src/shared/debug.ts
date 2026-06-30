// =============================================================
// 调试开关 — 统一管理主进程与渲染进程的调试功能
//
// 通过环境变量控制(也可在运行时通过 settings.debug 覆盖):
//   DEBUG                = "1" 或 "true" 开启全部调试
//   DEBUG_EAA            = "1" 开启 EAA 二进制调用详细日志
//   DEBUG_IPC            = "1" 开启 IPC 调用追踪
//   DEBUG_AGENT          = "1" 开启 Agent 执行链路追踪
//   DEBUG_CHAT           = "1" 开启聊天流式事件追踪
//   DEBUG_CRON           = "1" 开启定时任务执行追踪
//   DEBUG_PRIVACY        = "1" 开启隐私引擎调用追踪
//   DEBUG_RENDER         = "1" 渲染进程: 开启 UI 调试覆盖层
//   DEBUG_LOG_LEVEL      = "debug" | "info" | "warn" | "error" 覆盖日志级别
//   ENABLE_CDP           = "1" 开启 Chrome DevTools Protocol (端口 9222)
//   DEBUG_SLOW_THRESHOLD = 毫秒数, 超过此阈值的 IPC 调用会被警告 (默认 500)
//
// 使用方式:
//   主进程: import { debug } from './shared/debug'; debug.eaa && console.log(...)
//   渲染进程: import { debug } from '@shared/debug'; debug.render && console.log(...)
// =============================================================

/** 调试配置(运行时只读快照,启动时从环境变量读取一次) */
export interface DebugConfig {
  /** 总开关 — 开启全部调试子项 */
  enabled: boolean
  /** EAA 二进制调用详细日志(stdin/stdout/stderr/exitCode) */
  eaa: boolean
  /** IPC 调用追踪(通道名 + 耗时) */
  ipc: boolean
  /** Agent 执行链路追踪(prompt → LLM → tool → result) */
  agent: boolean
  /** 聊天流式事件追踪(token 级别) */
  chat: boolean
  /** 定时任务执行追踪 */
  cron: boolean
  /** 隐私引擎调用追踪 */
  privacy: boolean
  /** 渲染进程 UI 调试覆盖层(显示重渲染次数、IPC 耗时等) */
  render: boolean
  /** 日志级别覆盖(优先级高于 settings.general.logLevel) */
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'off' | null
  /** CDP 远程调试端口(0 = 关闭) */
  cdpPort: number
  /** 慢调用阈值(ms),超过会 warn */
  slowThresholdMs: number
}

function readEnvBool(key: string): boolean {
  const v = process.env[key]
  return v === '1' || v === 'true' || v === 'yes'
}

function readEnvInt(key: string, defaultVal: number): number {
  const v = process.env[key]
  if (!v) return defaultVal
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : defaultVal
}

function buildConfig(): DebugConfig {
  const enabled = readEnvBool('DEBUG')
  const anySubFlag =
    readEnvBool('DEBUG_EAA') ||
    readEnvBool('DEBUG_IPC') ||
    readEnvBool('DEBUG_AGENT') ||
    readEnvBool('DEBUG_CHAT') ||
    readEnvBool('DEBUG_CRON') ||
    readEnvBool('DEBUG_PRIVACY') ||
    readEnvBool('DEBUG_RENDER')

  const masterOn = enabled || anySubFlag

  const logLevelEnv = process.env.DEBUG_LOG_LEVEL
  const validLevels = ['debug', 'info', 'warn', 'error', 'off']
  const logLevel =
    logLevelEnv && validLevels.includes(logLevelEnv)
      ? (logLevelEnv as DebugConfig['logLevel'])
      : null

  const cdpPort = readEnvBool('ENABLE_CDP') ? 9222 : 0

  return {
    enabled: masterOn,
    eaa: masterOn && (readEnvBool('DEBUG_EAA') || enabled),
    ipc: masterOn && (readEnvBool('DEBUG_IPC') || enabled),
    agent: masterOn && (readEnvBool('DEBUG_AGENT') || enabled),
    chat: masterOn && (readEnvBool('DEBUG_CHAT') || enabled),
    cron: masterOn && (readEnvBool('DEBUG_CRON') || enabled),
    privacy: masterOn && (readEnvBool('DEBUG_PRIVACY') || enabled),
    render: masterOn && (readEnvBool('DEBUG_RENDER') || enabled),
    logLevel,
    cdpPort,
    slowThresholdMs: readEnvInt('DEBUG_SLOW_THRESHOLD', 500),
  }
}

/** 全局调试配置(启动时快照,运行时不变) */
export const debug: DebugConfig = buildConfig()

/**
 * 格式化调试日志前缀
 * 用法: console.log(debugPrefix('eaa'), 'message')
 */
export function debugPrefix(scope: string): string {
  return `[debug:${scope}]`
}

/**
 * 条件日志助手 — 仅当对应调试开关开启时输出
 * 用法: debugLog('eaa', 'execute', { command, args })
 */
export function debugLog(scope: keyof DebugConfig, msg: string, data?: unknown): void {
  if (!debug[scope]) return
  const prefix = debugPrefix(String(scope))
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, data)
  } else {
    console.log(`${prefix} ${msg}`)
  }
}

/**
 * 测量 IPC 调用耗时(仅当 debug.ipc 开启时输出)
 * 用法:
 *   const stop = startIpcTimer('eaa:score')
 *   // ... do work ...
 *   stop()
 */
export function startIpcTimer(channel: string): () => void {
  if (!debug.ipc) return () => {}
  const start = Date.now()
  return () => {
    const elapsed = Date.now() - start
    const prefix = debugPrefix('ipc')
    if (elapsed > debug.slowThresholdMs) {
      console.warn(`${prefix} SLOW ${channel} took ${elapsed}ms (> ${debug.slowThresholdMs}ms)`)
    } else {
      console.log(`${prefix} ${channel} took ${elapsed}ms`)
    }
  }
}
