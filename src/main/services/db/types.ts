// =============================================================
// DB 记录类型 — 纯数据结构定义
// 从 db-service.ts 拆分而来（纯重构,行为零变化）
// =============================================================

/** agent 执行历史记录 */
export interface AgentExecutionRecord {
  id?: number
  agent_id: string
  started_at: number
  finished_at?: number
  status: 'running' | 'success' | 'failure' | 'aborted'
  prompt?: string
  output?: string
  error?: string
  tokens_input?: number
  tokens_output?: number
  cost_total?: number
}

/** 定时任务日志 */
export interface CronLogRecord {
  id?: number
  task_id: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  timestamp: number
  metadata?: string // JSON 字符串
}

/** 班级记录（本地存档/删除管理） */
export interface ClassRecord {
  id: string
  /** 班级编号，与 EAA 学生 class_id 对齐，如 "G7-3" */
  class_id: string
  /** 班级显示名称，如 "七年级3班" */
  name: string
  /** 年级，如 "七年级" */
  grade?: string
  /** 备注 */
  note?: string
  /** 是否已存档（不再教这个班，但保留数据，默认隐藏该班学生） */
  archived: 0 | 1
  created_at: number
  archived_at?: number
  /** 班主任姓名（可选） */
  teacher?: string | null
}
