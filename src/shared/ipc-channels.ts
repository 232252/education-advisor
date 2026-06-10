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
export const IPC_AI_CHAT_ABORT = 'ai:chat-abort'
export const IPC_AI_OAUTH_LOGIN = 'ai:oauth-login'
export const IPC_AI_ADD_CUSTOM_MODEL = 'ai:add-custom-model'
export const IPC_AI_DEL_CUSTOM_MODEL = 'ai:del-custom-model'
export const IPC_AI_UPDATE_CUSTOM_MODEL = 'ai:update-custom-model'

// ===== Agent =====
export const IPC_AGENT_LIST = 'agent:list'
export const IPC_AGENT_GET = 'agent:get'
export const IPC_AGENT_UPDATE = 'agent:update'
export const IPC_AGENT_TOGGLE = 'agent:toggle'
export const IPC_AGENT_GET_SOUL = 'agent:get-soul'
export const IPC_AGENT_SET_SOUL = 'agent:set-soul'
export const IPC_AGENT_GET_RULES = 'agent:get-rules'
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
// ===== 隐私引擎 =====
export const IPC_PRIVACY_INIT = 'privacy:init'
export const IPC_PRIVACY_LOAD = 'privacy:load'
export const IPC_PRIVACY_ENABLE = 'privacy:enable'
export const IPC_PRIVACY_DISABLE = 'privacy:disable'
export const IPC_PRIVACY_LIST = 'privacy:list'
export const IPC_PRIVACY_ADD = 'privacy:add'
export const IPC_PRIVACY_ANONYMIZE = 'privacy:anonymize'
export const IPC_PRIVACY_DEANONYMIZE = 'privacy:deanonymize'
export const IPC_PRIVACY_FILTER = 'privacy:filter'
export const IPC_PRIVACY_DRYRUN = 'privacy:dryrun'
export const IPC_PRIVACY_BACKUP = 'privacy:backup'

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

// ===== 设置 =====
export const IPC_SETTINGS_GET = 'settings:get'
export const IPC_SETTINGS_SET = 'settings:set'
export const IPC_SETTINGS_RESET = 'settings:reset'

// ===== 系统 =====
export const IPC_SYS_OPEN_DIALOG = 'sys:open-dialog'
export const IPC_SYS_SAVE_DIALOG = 'sys:save-dialog'
export const IPC_SYS_OPEN_EXTERNAL = 'sys:open-external'
export const IPC_SYS_GET_PATH = 'sys:get-path'
export const IPC_SYS_CHECK_UPDATE = 'sys:check-update'
export const IPC_SYS_NOTIFICATION = 'sys:notification'

// ===== 学生档案 =====
export const IPC_PROFILE_GET = 'profile:get'
export const IPC_PROFILE_SET = 'profile:set'
export const IPC_PROFILE_VALIDATE_ACADEMIC = 'profile:validate-academic'

// ===== 对话持久化 =====
export const IPC_CHAT_SAVE_MESSAGE = 'chat:save-message'
export const IPC_CHAT_LOAD_MESSAGES = 'chat:load-messages'
export const IPC_CHAT_DELETE_SESSION = 'chat:delete-session'
export const IPC_CHAT_LIST_SESSIONS = 'chat:list-sessions'

// ===== 飞书 =====
// arch-P0-1 修复：原硬编码字符串，迁入共享常量
export const IPC_FEISHU_TEST = 'feishu:test'
export const IPC_FEISHU_BITABLE = 'feishu:bitable'
export const IPC_FEISHU_SEND = 'feishu:send'
export const IPC_FEISHU_STATUS = 'feishu:status'
export const IPC_FEISHU_SYNC_NOW = 'feishu:sync-now'

// ===== 日志 =====
// arch-P0-1 修复：原硬编码字符串，迁入共享常量
export const IPC_LOG_LIST = 'log:list'
export const IPC_LOG_READ = 'log:read'
export const IPC_LOG_CLEAR = 'log:clear'
export const IPC_LOG_FILTER = 'log:filter'
export const IPC_LOG_SEARCH = 'log:search'
export const IPC_LOG_EXPORT = 'log:export'
export const IPC_LOG_EXPORT_DIALOG = 'log:export-dialog'
// renderer→main 单向通知（ipcRenderer.send），不需要 ipcMain.handle
export const IPC_LOG_WRITE_RENDERER = 'log:write-renderer'

// ===== 系统（更新对话框扩展） =====
// 此前已被 sys-handlers.ts 引用但未在常量表中，补齐
export const IPC_SYS_SHOW_UPDATE_DIALOG = 'sys:show-update-dialog'

// ===== 系统维护 =====
export const IPC_SYS_RESET_FACTORY = 'sys:reset-factory'
export const IPC_SYS_DELETE_BY_CLASS = 'sys:delete-by-class'
export const IPC_SYS_DELETE_STUDENT_BY_NAME = 'sys:delete-student-by-name'
export const IPC_SYS_RESET_EVENTS_ONLY = 'sys:reset-events-only'
