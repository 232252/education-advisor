// =============================================================
// EAA 核心类型
// 类型定义严格匹配 EAA Rust 二进制 --output json 的实际输出格式
// =============================================================

/** EAA 风险等级（中文） */
export type EAARiskLevel = '低' | '中' | '高' | '极高'

/** EAA 实体状态 */
export type EAAEntityStatus = 'Active' | 'Transferred' | 'Suspended' | 'Deleted'

/** EAA 事件类型（Debug 格式） */
export type EAAEventType = 'ConductDeduct' | 'ConductBonus'

/** list-students 输出中的单个学生 */
export interface EAAStudent {
  name: string
  entity_id: string
  score: number
  delta: number
  risk: EAARiskLevel
  status: EAAEntityStatus
  events_count: number
  groups: string[]
  roles: string[]
  class_id: string | null
}

/** list-students 命令的完整 JSON 输出 */
export interface EAAStudentList {
  students: EAAStudent[]
  total: number
}

/** score 命令的输出（比 list-students 更详细） */
export interface EAAStudentScore {
  name: string
  entity_id: string
  score: number
  delta: number
  risk: EAARiskLevel
  risk_stored: string
  status: EAAEntityStatus
  events_count: number
  last_event_at: string
  groups: string[]
  roles: string[]
  class_id: string | null
}

/** info 命令的输出 */
export interface EAAInfoData {
  version: string
  students: number
  events: number
  data_dir: string
}

/** ranking 命令中单个排名项 */
export interface EAARankItem {
  rank: number
  name: string
  entity_id: string
  score: number
  delta: number
  risk: EAARiskLevel
  /** IPC handler 增强字段: 从 listStudents 关联获取 */
  class_id?: string | null
}

/** ranking 命令的完整 JSON 输出 */
export interface EAARankingData {
  ranking: EAARankItem[]
  total: number
}

/** history 命令中的单个事件 */
export interface EAAHistoryEvent {
  event_id: string
  timestamp: string // ISO 8601
  event_type: EAAEventType
  reason_code: string
  score_delta: number
  cumulative: number
  note: string
  tags: string[]
  reverted: boolean
}

/** history 命令的完整 JSON 输出 */
export interface EAAHistoryData {
  name: string
  entity_id: string
  score: number
  risk: EAARiskLevel
  events_count: number
  events: EAAHistoryEvent[]
}

/** event_to_json() 格式 -- search/tag/range 命令中的事件 */
export interface EAAEventRecord {
  event_id: string
  name: string
  entity_id: string
  timestamp: string // ISO 8601
  event_type: EAAEventType
  reason_code: string
  original_reason: string
  score_delta: number
  note: string
  tags: string[]
  operator: string
  is_valid: boolean
  reverted_by: string | null
}

/** search 命令的完整 JSON 输出 */
export interface EAASearchData {
  query: string
  total: number
  showing: number
  events: EAAEventRecord[]
}

/** codes 命令中单个原因码 */
export interface EAAReasonCode {
  code: string
  label: string
  category: 'deduct' | 'bonus' | 'system' | 'lab'
  score_delta: number | null
}

/** codes 命令的完整 JSON 输出 */
export interface EAACodesData {
  codes: EAAReasonCode[]
  version: string
}

/** stats 命令中 reason/tag 分布项 */
export interface EAADistributionItem {
  code?: string
  tag?: string
  count: number
}

/** stats 命令的完整 JSON 输出 */
export interface EAAStatsData {
  summary: {
    students: number
    total_events: number
    valid_events: number
    reverted_events: number
    total_delta: number
  }
  reason_distribution: EAADistributionItem[]
  tag_distribution: EAADistributionItem[]
  score_intervals: Record<string, number> // "极高(<60)", "中(60-80)", "高(80-100)", "低(>=100)"
}

/** validate 命令的完整 JSON 输出 */
export interface EAAValidateData {
  valid: boolean
  total_events: number
  errors: string[]
  warnings: string[]
}

/** doctor 命令的完整 JSON 输出 */
export interface EAADoctorData {
  healthy: boolean
  passed: number
  failed: number
  students: number
  events: number
  issues: string[]
}

/** summary 命令的完整 JSON 输出 */
export interface EAASummaryData {
  period: {
    since: string | null
    until: string | null
  }
  events: {
    total: number
    bonus_count: number
    deduct_count: number
    bonus_total: number
    deduct_total: number
  }
  risk_distribution: Record<EAARiskLevel, number>
  top_reason_codes: Array<{ code: string; count: number }>
  top_gainers: Array<{ name: string; delta: number; class_id?: string | null }>
  top_losers: Array<{ name: string; delta: number; class_id?: string | null }>
}

/** add-event 的输入参数（前端 -> 后端） */
export interface AddEventParams {
  studentName: string
  reasonCode: string
  delta?: number
  note?: string
  operator?: string
  tags?: string[]
  dryRun?: boolean
  force?: boolean
}

/** tag 命令（列表模式）的输出 */
export interface EAATagListData {
  tags: Array<{ tag: string; count: number }>
}

/** tag 命令（指定 tag 模式）的输出 */
export interface EAATagDetailData {
  tag: string
  total: number
  events: EAAEventRecord[]
}

/** range 命令的输出 */
export interface EAARangeData {
  start: string
  end: string
  total: number
  showing: number
  events: EAAEventRecord[]
  /** M10: events 达到有效 limit(默认 1000)时为 true,提示前端结果被截断,需缩小日期范围 */
  truncated?: boolean
}

/** set-student-meta 的输入参数 */
export interface SetStudentMetaParams {
  name: string
  group?: string
  role?: string
  classId?: string
  /** 若为 true,清除 class_id (优先级高于 classId) */
  clearClassId?: boolean
}

/** EAA 命令的通用结果包装（来自 eaa-bridge） */
export interface EAAResult<T = unknown> {
  success: boolean
  data: T | null
  stderr: string
  exitCode: number
}
