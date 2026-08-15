// =============================================================
// 隐私引擎 IPC 处理器
// - Init/Load/Disable: Rust CLI 要求密码作为**位置参数**传递
//   渲染进程仅在 init/load 时发送一次密码(明文,因 Rust CLI 需要),
//   主进程在内存中保留密码(eaaBridge.setPrivacyPassword)供后续命令复用,
//   渲染进程随后清空自身密码状态,避免长期持有
// - Add/List/Anonymize/Deanonymize/Filter/DryRun: 密码走 EAA_PRIVACY_PASSWORD 环境变量,
//   渲染进程不再需要重复传递密码
// - Lock/Unlock/Status: 显式锁定(清空内存密码)、解锁(重新输入密码)与状态查询
// - 入参 sanitize(防命令注入)
//
// 安全改进(从 Tauri 版本回迁):
//   R30-1: lock 状态下不允许 enable,防止隐私保护失效
//   R37-1: lock 状态下不允许 list/anonymize/deanonymize/filter/dryrun/backup,避免泄露
//   R37-2: 新增 unlock handler,此前 lock 后无解锁路径
//   R41-1/R41-2: anonymize/deanonymize/filter/dryrun 加 try-catch 兜底,转结构化错误
//   v3.2.9: init/load/disable 仅在 CLI 真正成功时才修改密码缓存
//           (EAA CLI 失败时返回 exitCode=0 + success=true + data 含 ❌)
//
// 注册入口: 子域 handler 拆分到 ./privacy/ 子目录
//   - params.ts            密码/文本/枚举 sanitize
//   - session-handlers.ts  init/load/unlock/lock/status(密码生命周期)
//   - masking-handlers.ts  enable/disable/list/add/anonymize/
//                          deanonymize/filter/dryrun/backup
// =============================================================

import type { BrowserWindow } from 'electron'
import { registerPrivacyMaskingHandlers } from './privacy/masking-handlers'
import { registerPrivacySessionHandlers } from './privacy/session-handlers'

export function registerPrivacyHandlers(_win: BrowserWindow) {
  registerPrivacySessionHandlers()
  registerPrivacyMaskingHandlers()

  console.log('[IPC] Privacy handlers registered (with lock/unlock/status)')
}
