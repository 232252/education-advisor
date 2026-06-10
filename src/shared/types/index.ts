// =============================================================
// 共享类型定义 -- 主进程和渲染进程共用
// =============================================================

// ===== AI / LLM =====

export interface ProviderInfo {
  id: string
  name: string
  supportsOAuth: boolean
  hasApiKey: boolean
  modelCount: number
  customBaseUrl?: string
  /** 用户主动隐藏（加入黑名单）；渲染端把它归到"已隐藏"分组 */
  hidden?: boolean
  /** enabledModels 白名单没有命中（但 provider 自身有模型）；
   *  仅作为视觉提示，不归到"已隐藏"分组。修复：原本这一状态被错误地
   *  标记为 hidden，导致所有 30+ provider 在白名单非空时全部被丢到
   *  "已隐藏"区域，无法看到也无法取消隐藏。 */
  disabledByWhitelist?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  api: string
  contextWindow: number
  maxOutputTokens: number
  costPerInputToken: number
  costPerOutputToken: number
  costCacheRead: number
  costCacheWrite: number
  supportsReasoning: boolean
  baseUrl: string
  isCustom?: boolean
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type StreamEvent =
  | { type: 'start'; model: string; provider: string }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end' }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'toolcall_start'; id: string; name: string }
  | { type: 'toolcall_delta'; id: string; argsDelta: string }
  | { type: 'toolcall_end'; id: string }
  | { type: 'tool_result'; id: string; result: string; isError: boolean }
  | { type: 'done'; usage: TokenUsage; cost: number }
  | { type: 'error'; message: string; retryable: boolean; retry?: RetryPolicyInfo }

/** 重试策略信息(从 settings.models.retry.* 读,附在 error 事件上供渲染端展示) */
export interface RetryPolicyInfo {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
  providerTimeoutMs: number
  shouldRetry: boolean
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  isError?: boolean
}

// ===== Agent =====

export type AgentStatus = 'idle' | 'running' | 'error'

export interface AgentConfig {
  id: string
  name: string
  role: string
  description: string
  enabled: boolean
  modelTier: 'high_quality' | 'low_cost'
  schedule: string[]
  capabilities: string[]
  riskThresholds?: RiskThresholds
}

export interface AgentListItem extends AgentConfig {
  status: AgentStatus
  lastRunAt?: number
  nextRunAt?: number
}

export interface AgentDetail extends AgentListItem {
  soulContent: string
  rulesContent: string
  executionHistory: AgentExecution[]
}

export interface AgentExecution {
  id: string
  agentId: string
  prompt: string
  output: string
  startedAt: number
  durationMs: number
  tokenUsage: TokenUsage
  cost: number
  status: 'success' | 'error' | 'timeout'
}

export interface RiskThresholds {
  high: number
  medium: number
  low: number
}

// ===== EAA 核心 =====
// 类型定义严格匹配 EAA Rust 二进制 --output json 的实际输出格式
/** EAA 风险等级（中文） */
export type EAARiskLevel = '低' | '中' | '高' | '极高'

/** EAA 实体状态 */
export type EAAEntityStatus = 'Active' | 'Transferred' | 'Suspended'

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
  top_gainers: Array<{ name: string; delta: number }>
  top_losers: Array<{ name: string; delta: number }>
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
}

/** set-student-meta 的输入参数 */
export interface SetStudentMetaParams {
  name: string
  group?: string
  role?: string
  classId?: string
}

/** EAA 命令的通用结果包装（来自 eaa-bridge） */
export interface EAAResult<T = unknown> {
  success: boolean
  data: T | null
  stderr: string
  exitCode: number
}

// ===== 隐私引擎 =====

export type EntityType =
  | 'student'
  | 'parent'
  | 'class'
  | 'school'
  | 'idcard'
  | 'address'
  | 'phone'
  | 'custom'

export interface PrivacyMapping {
  entityType: EntityType
  pseudonym: string
  realName: string
  createdAt: number
}

export interface PrivacyPreview {
  original: string
  anonymized: string
  deanonymized: string
  filtered?: string
}

// ===== 定时任务 =====

export interface CronTask {
  id: string
  name: string
  agentId: string
  expression: string
  prompt: string
  enabled: boolean
  modelTier: 'high_quality' | 'low_cost'
  lastRunAt?: number
  lastStatus?: 'success' | 'error' | 'timeout'
  nextRunAt?: number
}

export interface CronLogEntry {
  taskId: string
  agentId: string
  timestamp: number
  durationMs: number
  status: 'success' | 'error' | 'timeout'
  error?: string
}

// ===== 技能 =====

export interface Skill {
  name: string
  description: string
  content: string
  source: 'user' | 'project'
  filePath: string
}

// ===== 设置 =====

export interface UnifiedSettings {
  general: {
    dataDir: string
    defaultOperator: string
    theme: 'dark' | 'light' | 'system'
    language: 'zh-CN' | 'en-US'
    autoUpdate: boolean
    updateUrl: string
    telemetry: boolean
    logLevel: 'debug' | 'info' | 'warn' | 'error' | 'off'
    autoStart: boolean
    minimizeToTray: boolean
    closeBehavior: 'ask' | 'tray' | 'exit'
    /**
     * 远程维修模式（p2-remote-maintenance）
     * ON: 主进程启动 Chrome DevTools Protocol @ 127.0.0.1:9222 + Node Inspector @ 9230
     * OFF (默认): 关闭所有远程调试端口（避免本地端口暴露）
     * 注: 改动需重启应用生效（Chromium command line switch 只能在 app.whenReady 之前设置）
     */
    remoteMaintenance: boolean
  }
  models: {
    defaultProvider: string
    defaultModel: string
    highQualityModel: string
    lowCostModel: string
    enabledModels: string[]
    transport: 'sse' | 'websocket' | 'auto'
    cacheRetention: 'none' | 'short' | 'long'
    retry: {
      enabled: boolean
      maxRetries: number
      baseDelayMs: number
      providerTimeoutMs: number
    }
    providerBlacklist: string[]
    customModels: Record<
      string,
      Array<{
        id: string
        name: string
        contextWindow: number
        maxOutputTokens: number
        supportsReasoning: boolean
        costPerInputToken: number
        costPerOutputToken: number
        api?: string
        baseUrl?: string
      }>
    >
  }
  chat: {
    compaction: {
      enabled: boolean
      reserveTokens: number
      keepRecentTokens: number
    }
    steeringMode: 'all' | 'one-at-a-time'
    followUpMode: 'all' | 'one-at-a-time'
    showImages: boolean
    maxTokens: number
    conversationLogging: boolean
  }
  privacy: {
    enabled: boolean
    autoAnonymize: boolean
  }
  feishu: {
    appId: string
    appSecret: string
    userOpenId: string
    bitableSync: {
      enabled: boolean
      syncInterval: string
    }
  }
  advanced: {
    shellPath: string
    sessionDir: string
    httpIdleTimeoutMs: number
  }
  shortcuts: Record<string, string>
}

// ===== 学业成绩记录 =====

/**
 * 单次考试/测验的成绩记录
 * examType: 考试类型（月考/周考/期中/期末/模拟考/平时测试/随堂测验/自定义）
 * examName: 考试名称（如"月考1"、"2026-03-14周考"、"物理单元测"）
 * subjects: 科目名 → 分数（如 {"语文":95, "数学":88}），科目可任意扩展
 * date: 考试日期（可选）
 * notes: 备注（可选）
 */
export interface AcademicExamRecord {
  examType: string
  examName: string
  subjects: Record<string, number>
  date?: string
  notes?: string
}

// ===== 学生扩展档案 =====

export interface StudentProfileData {
  idCard?: string
  gender?: '男' | '女'
  birthDate?: string
  phone?: string
  address?: string
  parentName?: string
  parentPhone?: string
  fatherName?: string
  fatherPhone?: string
  motherName?: string
  motherPhone?: string
  classId?: string
  enrollmentDate?: string
  comments?: string
  /** @deprecated 改用 academicRecords */
  midtermGrades?: Record<string, number>
  /** @deprecated 改用 academicRecords */
  finalGrades?: Record<string, number>
  /** 学业成绩记录列表，支持任意考试类型和科目 */
  academicRecords?: AcademicExamRecord[]
  classRank?: number
  gradeRank?: number
  attendanceRate?: number
  awards?: string[]
  [key: string]: unknown
}

// ===== IPC 请求/响应类型 =====

export interface TestConnectionResult {
  success: boolean
  latencyMs: number
  model: string
  error?: string
}

export interface ConnectionTestParams {
  providerId: string
  apiKey: string
  baseUrl?: string
}
