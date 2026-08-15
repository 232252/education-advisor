// =============================================================
// 日志器共享状态 — 日志目录 / 写入计数 / 轮转节流状态
//
// 原为 logger.ts 的模块级 let 变量;ES module 导出绑定对导入方只读,
// 故改为可变对象容器,供各子模块(transport/rotation/query/export)读写同一份状态。
// =============================================================

import path from 'node:path'
import { app } from 'electron'

/**
 * 日志器模块级可变状态(单例)。
 * logsDir 初始值与原 logger.ts 顶层一致(userData/logs),
 * initLogger(dir) 可覆盖。
 */
export const loggerState = {
  logsDir: path.join(app.getPath('userData'), 'logs') as string,
  /** 写入计数器,达到 ROTATE_CHECK_INTERVAL 时触发轮转 */
  writeCounter: 0,
  /** 上次轮转检查的时间戳(毫秒),最少间隔 1 小时避免频繁检查 */
  lastRotateCheck: 0,
  /**
   * L-7 修复: 轮转操作 in-flight 标志,防止并发调用同时执行轮转。
   * 多个 writeLine 调用可能同时触发 rotateLogsIfNeeded,
   * 使用 Promise 去重确保只有一个轮转操作在执行。
   */
  rotateInFlight: null as Promise<void> | null,
}

export function getLogsDir(): string {
  return loggerState.logsDir
}
