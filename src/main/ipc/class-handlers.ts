// =============================================================
// Class IPC 处理器 — 班级管理（本地：存档/删除）
// 注册入口: 子域 handler 拆分到 ./class/ 子目录
//   - params.ts         班级/学生名/class_id sanitize
//   - crud-handlers.ts  列表/新建/更新/存档/恢复/删除(含级联清理)
//   - assign-handlers.ts 调班: 批量分入/移出(EAA set-student-meta)
// =============================================================

import { registerClassAssignHandlers } from './class/assign-handlers'
import { registerClassCrudHandlers } from './class/crud-handlers'

export function registerClassHandlers() {
  registerClassCrudHandlers()
  registerClassAssignHandlers()

  console.log('[IPC] Class handlers registered')
}
