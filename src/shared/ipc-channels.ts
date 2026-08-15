// =============================================================
// IPC 通道名定义 — 主进程和渲染进程共享
// =============================================================

// ===== AI / LLM =====
export const IPC_AI_LIST_PROVIDERS = 'ai:list-providers'
export const IPC_AI_LIST_MODELS = 'ai:list-models'
export const IPC_AI_TEST_CONNECTION = 'ai:test-connection'
export const IPC_AI_SET_API_KEY = 'ai:set-api-key'
export const IPC_AI_DELETE_API_KEY = 'ai:delete-api-key'
export const IPC_AI_CHAT = 'ai:chat'
export const IPC_AI_CHAT_STREAM = 'ai:chat-stream'
export const IPC_AI_OAUTH_LOGIN = 'ai:oauth-login'
export const IPC_AI_ADD_CUSTOM_MODEL = 'ai:add-custom-model'
export const IPC_AI_DEL_CUSTOM_MODEL = 'ai:del-custom-model'
export const IPC_AI_UPDATE_CUSTOM_MODEL = 'ai:update-custom-model'

// ===== 本地模型 (Ollama) =====
export const IPC_OLLAMA_DETECT = 'ollama:detect'
export const IPC_OLLAMA_START_SERVE = 'ollama:start-serve'
export const IPC_OLLAMA_STOP_SERVE = 'ollama:stop-serve'
export const IPC_OLLAMA_LIST_MODELS = 'ollama:list-models'
export const IPC_OLLAMA_PULL_MODEL = 'ollama:pull-model'
export const IPC_OLLAMA_DELETE_MODEL = 'ollama:delete-model'
// 主→渲染: 下载进度推送
export const IPC_OLLAMA_PULL_PROGRESS = 'ollama:pull-progress'

// ===== Agent =====
export const IPC_AGENT_LIST = 'agent:list'
export const IPC_AGENT_GET = 'agent:get'
export const IPC_AGENT_UPDATE = 'agent:update'
export const IPC_AGENT_TOGGLE = 'agent:toggle'
export const IPC_AGENT_SET_SOUL = 'agent:set-soul'
export const IPC_AGENT_SET_RULES = 'agent:set-rules'
export const IPC_AGENT_RUN_MANUAL = 'agent:run-manual'
export const IPC_AGENT_GET_HISTORY = 'agent:get-history'
export const IPC_AGENT_STATUS_UPDATE = 'agent:status-update'
export const IPC_AGENT_ABORT = 'agent:abort'

// ===== EAA 核心 =====
export const IPC_EAA_INFO = 'eaa:info'
export const IPC_EAA_SCORE = 'eaa:score'
export const IPC_EAA_RANKING = 'eaa:ranking'
export const IPC_EAA_REPLAY = 'eaa:replay'
export const IPC_EAA_ADD_EVENT = 'eaa:add-event'
export const IPC_EAA_REVERT_EVENT = 'eaa:revert-event'
export const IPC_EAA_HISTORY = 'eaa:history'
export const IPC_EAA_SEARCH = 'eaa:search'
export const IPC_EAA_RANGE = 'eaa:range'
export const IPC_EAA_TAG = 'eaa:tag'
export const IPC_EAA_STATS = 'eaa:stats'
export const IPC_EAA_VALIDATE = 'eaa:validate'
export const IPC_EAA_EXPORT = 'eaa:export'
export const IPC_EAA_LIST_STUDENTS = 'eaa:list-students'
export const IPC_EAA_ADD_STUDENT = 'eaa:add-student'
export const IPC_EAA_DELETE_STUDENT = 'eaa:delete-student'
export const IPC_EAA_SET_STUDENT_META = 'eaa:set-student-meta'
export const IPC_EAA_IMPORT = 'eaa:import'
export const IPC_EAA_CODES = 'eaa:codes'
export const IPC_EAA_DOCTOR = 'eaa:doctor'
export const IPC_EAA_SUMMARY = 'eaa:summary'
export const IPC_EAA_DASHBOARD = 'eaa:dashboard'
export const IPC_EAA_EXPORT_FORMATS = 'eaa:export-formats'
// 清空 EAA 读缓存（「刷新」按钮调用，确保下次读取重新 spawn 拉取最新数据）
export const IPC_EAA_INVALIDATE_CACHE = 'eaa:invalidate-cache'
// ===== 隐私引擎 =====
export const IPC_PRIVACY_INIT = 'privacy:init'
export const IPC_PRIVACY_LOAD = 'privacy:load'
export const IPC_PRIVACY_LIST = 'privacy:list'
export const IPC_PRIVACY_ADD = 'privacy:add'
export const IPC_PRIVACY_DRYRUN = 'privacy:dryrun'
export const IPC_PRIVACY_BACKUP = 'privacy:backup'
export const IPC_PRIVACY_LOCK = 'privacy:lock'
export const IPC_PRIVACY_STATUS = 'privacy:status'

// ===== 定时任务 =====
export const IPC_CRON_LIST = 'cron:list'
export const IPC_CRON_ADD = 'cron:add'
export const IPC_CRON_UPDATE = 'cron:update'
export const IPC_CRON_REMOVE = 'cron:remove'
export const IPC_CRON_TOGGLE = 'cron:toggle'
export const IPC_CRON_RUN_NOW = 'cron:run-now'
export const IPC_CRON_GET_LOGS = 'cron:get-logs'
export const IPC_CRON_STATUS_UPDATE = 'cron:status-update'

// ===== 技能 =====
export const IPC_SKILL_LIST = 'skill:list'
export const IPC_SKILL_GET = 'skill:get'
export const IPC_SKILL_SAVE = 'skill:save'
export const IPC_SKILL_DELETE = 'skill:delete'

// ===== MCP (Model Context Protocol) =====
export const IPC_MCP_LIST = 'mcp:list'
export const IPC_MCP_CONNECT = 'mcp:connect'
export const IPC_MCP_DISCONNECT = 'mcp:disconnect'
export const IPC_MCP_LIST_TOOLS = 'mcp:list-tools'
export const IPC_MCP_TEST = 'mcp:test'
export const IPC_MCP_ADD = 'mcp:add'
export const IPC_MCP_UPDATE = 'mcp:update'
export const IPC_MCP_REMOVE = 'mcp:remove'

// ===== 设置 =====
export const IPC_SETTINGS_GET = 'settings:get'
export const IPC_SETTINGS_SET = 'settings:set'
export const IPC_SETTINGS_RESET = 'settings:reset'

// ===== 系统 =====
export const IPC_SYS_OPEN_DIALOG = 'sys:open-dialog'
export const IPC_SYS_SAVE_DIALOG = 'sys:save-dialog'
export const IPC_SYS_GET_PATH = 'sys:get-path'
export const IPC_SYS_CHECK_UPDATE = 'sys:check-update'
export const IPC_SYS_READ_FILE = 'sys:read-file'

// ===== 学生档案 =====
export const IPC_PROFILE_GET = 'profile:get'
export const IPC_PROFILE_SET = 'profile:set'

// ===== 学业管理 (Academics) =====
export const IPC_ACADEMIC_GET_CONFIG = 'academic:get-config'
export const IPC_ACADEMIC_LIST_EXAMS = 'academic:list-exams'
export const IPC_ACADEMIC_CREATE_EXAM = 'academic:create-exam'
export const IPC_ACADEMIC_DELETE_EXAM = 'academic:delete-exam'
export const IPC_ACADEMIC_GET_GRADES = 'academic:get-grades'
export const IPC_ACADEMIC_BATCH_SET_GRADES = 'academic:batch-set-grades'
export const IPC_ACADEMIC_GET_CLASS_GRADES = 'academic:get-class-grades'

// ===== 班级管理（本地：存档/删除） =====
export const IPC_CLASS_LIST = 'class:list'
export const IPC_CLASS_CREATE = 'class:create'
export const IPC_CLASS_UPDATE = 'class:update'
export const IPC_CLASS_ARCHIVE = 'class:archive'
export const IPC_CLASS_RESTORE = 'class:restore'
export const IPC_CLASS_DELETE = 'class:delete'
// 调班：批量把学生分入班级（联动 EAA set-student-meta）
export const IPC_CLASS_ASSIGN = 'class:assign'
// 调班进度事件（主进程 -> 渲染进程，串行 spawn 较慢时实时推送）
export const IPC_CLASS_ASSIGN_PROGRESS = 'class:assign-progress'

// ===== 对话持久化 =====
export const IPC_CHAT_SAVE_MESSAGE = 'chat:save-message'
export const IPC_CHAT_LOAD_MESSAGES = 'chat:load-messages'
export const IPC_CHAT_DELETE_SESSION = 'chat:delete-session'
export const IPC_CHAT_LIST_SESSIONS = 'chat:list-sessions'

// ===== 飞书 =====
// arch-P0-1 修复：原硬编码字符串，迁入共享常量
export const IPC_FEISHU_TEST = 'feishu:test'
export const IPC_FEISHU_BITABLE = 'feishu:bitable'
export const IPC_FEISHU_STATUS = 'feishu:status'
// 飞书长连接机器人:启动/停止/状态查询 + 状态推送(主→渲染)
export const IPC_FEISHU_BOT_START = 'feishu:bot-start'
export const IPC_FEISHU_BOT_STOP = 'feishu:bot-stop'
export const IPC_FEISHU_BOT_STATUS = 'feishu:bot-status'
export const IPC_FEISHU_BOT_STATUS_UPDATE = 'feishu:bot-status-update'
// 网络诊断:排查飞书远程访问连接问题
export const IPC_FEISHU_DIAGNOSE = 'feishu:diagnose'

// ===== 日志 =====
// arch-P0-1 修复：原硬编码字符串，迁入共享常量
export const IPC_LOG_LIST = 'log:list'
export const IPC_LOG_READ = 'log:read'
export const IPC_LOG_CLEAR = 'log:clear'
export const IPC_LOG_FILTER = 'log:filter'
export const IPC_LOG_SEARCH = 'log:search'
export const IPC_LOG_EXPORT_DIALOG = 'log:export-dialog'
// renderer→main 单向通知（ipcRenderer.send），不需要 ipcMain.handle
export const IPC_LOG_WRITE_RENDERER = 'log:write-renderer'

// ===== 系统（更新对话框扩展） =====
// 此前已被 sys-handlers.ts 引用但未在常量表中，补齐
export const IPC_SYS_SHOW_UPDATE_DIALOG = 'sys:show-update-dialog'
