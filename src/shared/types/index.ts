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
  hidden?: boolean
  /** 该 provider 下存在 $0 免费（input+output 均 0 成本）模型 */
  hasFreeModels?: boolean
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
  | {
      type: 'retry'
      attempt: number
      maxRetries: number
      delayMs: number
      reason: string
    }

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
  /** MCP 集成:该 Agent 启用的全局 MCP server ID 列表 */
  mcpServers?: string[]
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

/** 班级记录（本地管理：存档/删除）。class_id 与 EAA 学生 class_id 对齐 */
export interface ClassEntity {
  id: string
  /** 班级编号，与 EAA 学生 class_id 对齐，如 "G7-3" */
  class_id: string
  /** 班级显示名称，如 "七年级3班" */
  name: string
  /** 年级，如 "七年级" */
  grade?: string
  /** 备注 */
  note?: string
  /** 班主任姓名 */
  teacher?: string
  /** 是否已存档（不再教这个班，默认隐藏该班学生） */
  archived: boolean
  created_at: number
  archived_at?: number
}

/** 新建/更新班级的参数 */
export interface ClassUpsertParams {
  class_id: string
  name: string
  grade?: string
  note?: string
  teacher?: string
}

/** 调班：把学生分到某个班级（EAA class_id 同步更新） */
export interface ClassAssignParams {
  class_id: string
  student_names: string[]
}

/** 调班：单个学生退出班级（清空 EAA class_id） */
export interface ClassRemoveStudentParams {
  student_name: string
}

/** 班级下学生列表返回 */
export interface ClassStudentsResult {
  class_id: string
  students: Array<{
    name: string
    entity_id: string
    status: string
    score: number
    risk: string
    events_count: number
  }>
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

// ===== 隐私引擎 =====

export type EntityType =
  | 'person'
  | 'place'
  | 'org'
  | 'phone'
  | 'email'
  | 'id_card'
  | 'student_id'
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
  /** R57-3 H3: 新增 skipped_concurrent_limit; R57-3 H1: 新增 pending(恢复时初始态)
   *  circuit-breaker: 连续配额类错误(429/quota)熔断后,cron 触发被跳过 */
  lastStatus?:
    | 'success'
    | 'error'
    | 'timeout'
    | 'skipped_concurrent_limit'
    | 'skipped_circuit_breaker'
    | 'pending'
  nextRunAt?: number
}

export interface CronLogEntry {
  taskId: string
  agentId: string
  timestamp: number
  durationMs: number
  /** R57-3 H3: 新增 skipped_concurrent_limit(并发上限跳过时记录)
   *  circuit-breaker: 熔断跳过时记录 */
  status: 'success' | 'error' | 'timeout' | 'skipped_concurrent_limit' | 'skipped_circuit_breaker'
  error?: string
}

// ===== 技能 =====

export interface Skill {
  name: string
  description: string
  content: string
  source: 'user' | 'project'
  filePath: string
  /** MCP 集成:技能级临时 MCP server 配置(激活时加载,结束时清理) */
  mcpServers?: McpServerConfig[]
}

// ===== MCP (Model Context Protocol) =====

export type McpTransport = 'stdio' | 'sse' | 'websocket'

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  enabled: boolean
  transport: McpTransport
  /** stdio 传输:要执行的命令 */
  command?: string
  /** stdio 传输:命令参数 */
  args?: string[]
  /** stdio 传输:环境变量 */
  env?: Record<string, string>
  /** sse/websocket 传输:服务器 URL */
  url?: string
  /** sse/websocket 传输:HTTP 请求头 */
  headers?: Record<string, string>
  /** 覆盖来源标记:用户级覆盖了某个全局同 id server 时标记,remove 时据此恢复全局默认 */
  overrides?: 'global'
  /** 配置来源(运行时注入,不持久化):global 只读 / user 可改 */
  source?: 'global' | 'user'
}

export interface McpTool {
  serverId: string
  name: string
  description: string
  /** JSON Schema 格式的参数定义 */
  inputSchema: object
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
  lastError?: string
  transport: McpTransport
  /** 配置来源:全局只读 / 用户级可改 */
  source: 'global' | 'user'
  /** 是否启用(透传给前端显示开关) */
  enabled: boolean
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
    /** H-4 修复: cron 调度时区(IANA 标识符,如 Asia/Shanghai) */
    timezone: string
    /** R57-3 H2: agent 执行超时(分钟),-1 表示不限,默认 5 */
    agentTimeoutMins: number
    /** R57-3 H3: cron 任务最大并发数,默认 5 */
    maxConcurrentCronTasks: number
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
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  }
  privacy: {
    enabled: boolean
    autoAnonymize: boolean
  }
  feishu: {
    /** 域名版本: 'feishu' 国内版(open.feishu.cn) / 'lark' 国际版(open.larksuite.com) */
    domain: 'feishu' | 'lark'
    appId: string
    appSecret: string
    userOpenId: string
    bitableAppToken: string
    bitableTableId: string
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
  mcp: {
    /** MCP 集成 feature flag (默认 false,关闭时 McpService 进入 no-op 模式) */
    enabled: boolean
  }
  shortcuts: Record<string, string>
}

// ===== 学业管理 (Academics) =====

/** 考试类型 */
export type ExamType = 'monthly' | 'midterm' | 'final' | 'quiz' | 'test' | 'mock' | 'other'

/** 科目分类 */
export type SubjectCategory = 'core' | 'science' | 'arts' | 'pe' | 'art' | 'other'

/** 科目定义 */
export interface SubjectDef {
  id: string
  name: string
  category: SubjectCategory
  fullMark: number
  /** 是否为主科(语数英) */
  isCore?: boolean
}

/** 考试定义 */
export interface ExamDef {
  id: string
  name: string
  type: ExamType
  date: string
  semester: string
  scope?: string
  /** 包含的科目ID列表 */
  subjects: string[]
  createdAt: string
}

/** 试卷分析结果 (占位结构,后续接入 AI/OCR) */
export interface PaperAnalysisResult {
  filePath: string
  fileName: string
  fileType: string
  examId: string | null
  subjectId: string | null
  questionScores: number[]
  analysis: string
  analyzedAt: string
}

/** 成绩记录 (单个学生在单场考试的单科成绩) */
export interface GradeRecord {
  examId: string
  subjectId: string
  studentName: string
  /** 分数; null 表示缺考 */
  score: number | null
  fullMark: number
  /** 班级排名(可选) */
  classRank?: number
  /** 年级排名(可选) */
  gradeRank?: number
  /** 班级平均分(可选,用于对比) */
  classAverage?: number
  /** 年级平均分(可选) */
  gradeAverage?: number
  note?: string
  /** 试卷分析结果 */
  paperAnalysis?: {
    questionScores?: number[]
    analysis?: string
    analyzedAt?: string
  }
  updatedAt: string
}

/** 学业配置 */
export interface AcademicConfig {
  subjects: SubjectDef[]
  defaultExamTypes: { value: ExamType; label: string }[]
}

/** 成绩录入模式 */
export type GradeEntryMode = 'single-subject' | 'all-subjects'

// ===== 学生扩展档案 =====

export interface StudentProfileData {
  idCard?: string
  gender?: '男' | '女'
  birthDate?: string
  phone?: string
  address?: string
  parentName?: string
  parentPhone?: string
  enrollmentDate?: string
  comments?: string
  midtermGrades?: Record<string, number>
  finalGrades?: Record<string, number>
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

// ===== 飞书长连接机器人状态 =====
export type FeishuBotStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface FeishuBotStatusInfo {
  status: FeishuBotStatus
  appId?: string
  /** 上次错误信息(status === 'error' 时有值) */
  error?: string
  /** 已连接的时间戳(ms),status === 'connected' 时有值 */
  connectedAt?: number
  /** 正在处理的消息数(诊断用) */
  processingCount?: number
}

// ===== 本地模型 (Ollama) =====
export interface OllamaModelInfo {
  name: string
  size: number
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaStatusInfo {
  /** 二进制是否可用(系统安装或打包) */
  available: boolean
  /** serve 是否在运行 */
  serveRunning: boolean
  /** 二进制路径(诊断用) */
  binaryPath?: string
}

export interface OllamaPullProgressInfo {
  /** 模型名 */
  model: string
  /** 状态: pulling / success / error */
  status: string
  /** 已下载字节 */
  completed?: number
  /** 总字节 */
  total?: number
}
