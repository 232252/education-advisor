// =============================================================
// Preload API — EAA 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const eaaApi = {
  // [r] 系统信息
  info: () => ipcRenderer.invoke(IPC.IPC_EAA_INFO),
  // [r] 学生评分
  score: (name: string) => ipcRenderer.invoke(IPC.IPC_EAA_SCORE, name),
  // [r] 排行榜
  ranking: (n?: number) => ipcRenderer.invoke(IPC.IPC_EAA_RANKING, n),
  // [r] 回放
  replay: () => ipcRenderer.invoke(IPC.IPC_EAA_REPLAY),
  // [w] 新增事件
  addEvent: (params: unknown) => ipcRenderer.invoke(IPC.IPC_EAA_ADD_EVENT, params),
  // [c] 回滚事件 — UI 层应二次确认
  revertEvent: (eventId: string, reason: string) =>
    ipcRenderer.invoke(IPC.IPC_EAA_REVERT_EVENT, eventId, reason),
  // [r] 学生历史
  history: (name: string) => ipcRenderer.invoke(IPC.IPC_EAA_HISTORY, name),
  // [r] 搜索
  search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.IPC_EAA_SEARCH, query, limit),
  // [r] 时间范围
  range: (start: string, end: string, limit?: number) =>
    ipcRenderer.invoke(IPC.IPC_EAA_RANGE, start, end, limit),
  // [r] 按 tag 查询
  tag: (tag?: string) => ipcRenderer.invoke(IPC.IPC_EAA_TAG, tag),
  // [r] 统计
  stats: () => ipcRenderer.invoke(IPC.IPC_EAA_STATS),
  // [r] 校验数据
  validate: () => ipcRenderer.invoke(IPC.IPC_EAA_VALIDATE),
  // [w] 导出(写文件)
  export: (format: string, outputFile?: string) =>
    ipcRenderer.invoke(IPC.IPC_EAA_EXPORT, format, outputFile),
  // [r] 列出学生
  listStudents: () => ipcRenderer.invoke(IPC.IPC_EAA_LIST_STUDENTS),
  // [w] 新增学生
  addStudent: (name: string) => ipcRenderer.invoke(IPC.IPC_EAA_ADD_STUDENT, name),
  // [c] 删除学生 — preload 层自动附带 { confirm: true, reason }
  // handler 需要 options.confirm 才真正执行删除；前端应先 UI 确认
  deleteStudent: (name: string, reason?: string) =>
    ipcRenderer.invoke(IPC.IPC_EAA_DELETE_STUDENT, name, { confirm: true, reason }),
  // [w] 设置学生元数据
  setStudentMeta: (params: unknown) => ipcRenderer.invoke(IPC.IPC_EAA_SET_STUDENT_META, params),
  // [w] 导入数据
  import: (filePath: string) => ipcRenderer.invoke(IPC.IPC_EAA_IMPORT, filePath),
  // [r] reason-codes
  codes: () => ipcRenderer.invoke(IPC.IPC_EAA_CODES),
  // [r] 健康检查
  doctor: () => ipcRenderer.invoke(IPC.IPC_EAA_DOCTOR),
  // [r] 摘要
  summary: (since?: string, until?: string) =>
    ipcRenderer.invoke(IPC.IPC_EAA_SUMMARY, since, until),
  // [w] 生成 dashboard(写文件)
  dashboard: (outputDir?: string) => ipcRenderer.invoke(IPC.IPC_EAA_DASHBOARD, outputDir),
  // [r] 获取 EAA 支持的导出格式列表(不调用二进制,从静态配置返回)
  exportFormats: () => ipcRenderer.invoke(IPC.IPC_EAA_EXPORT_FORMATS),
  // [w] 清空 EAA 读缓存(刷新按钮调用,下次读取重新 spawn 拉取最新数据)
  invalidateCache: () => ipcRenderer.invoke(IPC.IPC_EAA_INVALIDATE_CACHE),
}
