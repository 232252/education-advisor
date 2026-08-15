// =============================================================
// Logger — 主进程全链路日志 入口
// 5 档:debug / info / warn / error / off
// 文件: logs/main-YYYY-MM-DD.log + logs/chat-YYYY-MM-DD.log + logs/renderer-YYYY-MM-DD.log
// 支持运行时 setLevel(被 settings-handlers 触发)
//
// 实现已按职责拆分至 log/ 目录:
//   - levels.ts           级别控制(LogLevel/级别比较/运行时切换)
//   - state.ts            共享可变状态(日志目录/写入计数/轮转节流)
//   - format.ts           格式化(行格式/值序列化/日期)
//   - file-transport.ts   文件 transport(追加写入/目录保障/清空)
//   - rotation.ts         轮转清理(过期日志删除)
//   - console-redirect.ts console 劫持与 initLogger
//   - api.ts              公开写入 API(log/logChat/logRenderer)
//   - query.ts            查询(列文件/tail/级别过滤/搜索)
//   - export.ts           导出(含系统关键目录安全约束)
//
// 本文件保留原导出集(re-export),签名不变。
// =============================================================

export { log, logChat, logRenderer } from './log/api'
export { initLogger } from './log/console-redirect'
export { exportLog } from './log/export'
export { clearAllLogs } from './log/file-transport'
export type { LogLevel } from './log/levels'
export { getLogLevel, setLogLevel } from './log/levels'
export { listLogFiles, readLogTail, readLogTailByLevel, searchLog } from './log/query'
export { getLogsDir } from './log/state'
