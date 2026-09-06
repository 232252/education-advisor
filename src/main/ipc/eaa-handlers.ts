// =============================================================
// EAA 核心 IPC 处理器 — 纯聚合入口(M18)
// 完整覆盖 EAA CLI 全部 21 个子命令 + export-formats + invalidate-cache
// 各域 handler 拆分到 ./eaa/ 子目录:
//   - handlers-system.ts  info/replay/tag/stats/validate/codes/doctor/summary
//                         + ranking/list-students/invalidate-cache 与失效编排
//   - handlers-students.ts  学生域(score/history/add/delete/set-meta/search)
//   - handlers-events.ts    事件域(add-event/revert/range)
//   - handlers-export.ts    导入导出域(import/export/dashboard/export-formats)
//   - params.ts             参数组装(buildXxxArgs)
//   - cache.ts              缓存上下文创建 + scoreCache 预热
// 本文件仅"聚合 register + 一行日志",不含 handler 逻辑
// (ipc/ 组织规则见 docs/ARCHITECTURE.md)
// =============================================================

import type { BrowserWindow } from 'electron'
import { createEaaCacheContext } from './eaa/cache'
import { registerEventHandlers } from './eaa/handlers-events'
import { registerExportHandlers } from './eaa/handlers-export'
import { registerStudentHandlers } from './eaa/handlers-students'
import { registerSystemHandlers } from './eaa/handlers-system'

export function registerEAAHandlers(_win: BrowserWindow) {
  // ----- 共享缓存上下文 (staticCache/scoreCache 创建见 eaa/cache.ts) -----
  const { staticCache, scoreCache, setStaticCacheIfSuccess } = createEaaCacheContext()

  // 系统域(含 ranking/list-students/invalidate-cache)先注册,
  // 返回 invalidateStudentsCache 供学生/事件/导出域共享失效编排
  const { invalidateStudentsCache } = registerSystemHandlers({
    staticCache,
    scoreCache,
    setStaticCacheIfSuccess,
  })

  // 各域 handler 注册(共享缓存与缓存失效回调注入)
  registerStudentHandlers({ scoreCache, invalidateStudentsCache })
  registerEventHandlers({ invalidateStudentsCache })
  registerExportHandlers({ invalidateStudentsCache })

  // 通道数以 src/shared/ipc-channels.ts 的 eaa:* 为准(doc-stats 门禁守护总数);
  // 此处不写具体数字,避免子域增减时日志漂移
  console.log('[IPC] EAA handlers registered (events/students/export/system domains + invalidate-cache)')
}
