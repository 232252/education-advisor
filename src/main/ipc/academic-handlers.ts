// =============================================================
// Academic IPC 处理器 — 科目/考试/成绩
// 注册入口: 各子域 handler 拆分到 ./academic/ 子目录
//   - cache.ts            TTL 读缓存(R136)+ 写后失效
//   - params.ts           学生姓名 sanitize
//   - config-handlers.ts  学业配置读取
//   - exam-handlers.ts    考试列表/新建/删除
//   - grade-handlers.ts   批量/班级成绩
// =============================================================

import { registerAcademicConfigHandlers } from './academic/config-handlers'
import { registerAcademicExamHandlers } from './academic/exam-handlers'
import { registerAcademicGradeHandlers } from './academic/grade-handlers'

export function registerAcademicHandlers(): void {
  registerAcademicConfigHandlers()
  registerAcademicExamHandlers()
  registerAcademicGradeHandlers()

  console.log('[IPC] Academic handlers registered')
}
