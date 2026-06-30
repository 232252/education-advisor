// =============================================================
// Preload 脚本 — contextBridge 安全桥接
// 在渲染进程暴露 window.api，类型安全地调用主进程功能
//
// 最小权限原则:
// - 每个方法标注权限级别: [r] read-only / [w] write / [c] critical
// - [c] critical 方法应在 UI 层加二次确认(删除/重置/外部链接等)
// - 不暴露 ipcRenderer/fs/path/process 等危险 API
// - 事件订阅返回取消订阅函数,避免泄漏监听器
// =============================================================

import { contextBridge, ipcRenderer } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { StreamEvent } from '../../shared/types'

// =============================================================
// 暴露给渲染进程的安全 API
// =============================================================
contextBridge.exposeInMainWorld('api', {
  // ----- AI / LLM -----
  ai: {
    // [r] 列出所有已配置 Provider
    listProviders: () => ipcRenderer.invoke(IPC.IPC_AI_LIST_PROVIDERS),

    // [r] 列出某 Provider 的可用模型
    listModels: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_LIST_MODELS, providerId),

    // [r] 测试 Provider 连通性(apiKey 不持久化)
    testConnection: (providerId: string, apiKey: string, baseUrl?: string) =>
      ipcRenderer.invoke(IPC.IPC_AI_TEST_CONNECTION, providerId, apiKey, baseUrl),

    // [w] 设置 API Key(走 keystore-service 加密存储)
    setApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke(IPC.IPC_AI_SET_API_KEY, providerId, apiKey),

    // [c] 删除 API Key — UI 层应二次确认
    deleteApiKey: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_DELETE_API_KEY, providerId),

    // [w] OAuth 登录(P0-4 handler)
    oauthLogin: (providerId: string) => ipcRenderer.invoke(IPC.IPC_AI_OAUTH_LOGIN, providerId),

    // [w] 发起对话(走 LLM 流式)
    chat: (params: {
      providerId: string
      modelId: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
      thinking?: string
      maxTokens?: number
    }) => ipcRenderer.invoke(IPC.IPC_AI_CHAT, params),

    // [c] 中断对话 — 通常按钮 click 触发
    abortChat: () => ipcRenderer.invoke(IPC.IPC_AI_CHAT_ABORT),

    // [w] 添加自定义模型
    addCustomModel: (params: {
      providerId: string
      modelId: string
      name?: string
      contextWindow?: number
      maxOutputTokens?: number
      supportsReasoning?: boolean
    }) => ipcRenderer.invoke(IPC.IPC_AI_ADD_CUSTOM_MODEL, params),

    // [c] 删除自定义模型
    deleteCustomModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke(IPC.IPC_AI_DEL_CUSTOM_MODEL, providerId, modelId),

    // [w] 更新自定义模型属性
    updateCustomModel: (params: {
      providerId: string
      modelId: string
      name?: string
      contextWindow?: number
      maxOutputTokens?: number
      supportsReasoning?: boolean
      costPerInputToken?: number
      costPerOutputToken?: number
      api?: string
      baseUrl?: string
    }) => ipcRenderer.invoke(IPC.IPC_AI_UPDATE_CUSTOM_MODEL, params),

    /** 订阅 LLM 流式事件，返回取消订阅函数 */
    onStream: (callback: (event: StreamEvent) => void) => {
      const handler = (_e: unknown, data: StreamEvent) => callback(data)
      ipcRenderer.on(IPC.IPC_AI_CHAT_STREAM, handler)
      return () => {
        ipcRenderer.removeListener(IPC.IPC_AI_CHAT_STREAM, handler)
      }
    },
  },

  // ----- Agent -----
  agent: {
    // [r] 列出所有 agent
    list: () => ipcRenderer.invoke(IPC.IPC_AGENT_LIST),

    // [r] 获取单个 agent 配置
    get: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET, id),

    // [w] 启用/停用 agent(持久化)
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.IPC_AGENT_TOGGLE, id, enabled),

    // [w] 更新 Agent 配置
    update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.IPC_AGENT_UPDATE, id, patch),

    // [r] 读取 agent SOUL.md
    getSoul: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET_SOUL, id),

    // [w] 写回 agent SOUL.md
    setSoul: (id: string, content: string) =>
      ipcRenderer.invoke(IPC.IPC_AGENT_SET_SOUL, id, content),

    // [r] 读取 agent AGENTS.md (rules)
    getRules: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET_RULES, id),

    // [w] 写回 agent AGENTS.md (rules)
    setRules: (id: string, content: string) =>
      ipcRenderer.invoke(IPC.IPC_AGENT_SET_RULES, id, content),

    // [w] 手动触发 agent 执行
    runManual: (id: string, prompt: string, history?: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke(IPC.IPC_AGENT_RUN_MANUAL, id, prompt, history),

    // [r] 读取 agent 执行历史
    getHistory: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET_HISTORY, id),

    // [c] 中断 agent 执行
    abort: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_ABORT, id),

    onStatusUpdate: (callback: (data: unknown) => void) => {
      const handler = (_e: unknown, data: unknown) => callback(data)
      ipcRenderer.on(IPC.IPC_AGENT_STATUS_UPDATE, handler)
      return () => {
        ipcRenderer.removeListener(IPC.IPC_AGENT_STATUS_UPDATE, handler)
      }
    },
  },

  // ----- EAA -----
  eaa: {
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
  },

  // ----- 隐私引擎 -----
  privacy: {
    // [w] 初始化(密码仅在本次 IPC 传输,主进程在内存中保留,渲染进程应随后清空自身状态)
    init: (password: string, autoScan?: boolean) =>
      ipcRenderer.invoke(IPC.IPC_PRIVACY_INIT, password, autoScan),
    // [w] 载入隐私字典(密码仅在本次 IPC 传输)
    load: (password: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_LOAD, password),
    // [w] 启用隐私引擎(使用主进程内存中已缓存的密码)
    enable: () => ipcRenderer.invoke(IPC.IPC_PRIVACY_ENABLE),
    // [w] 停用隐私引擎(需要密码)
    disable: (password: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_DISABLE, password),
    // [r] 列出映射(使用主进程内存中已缓存的密码,渲染进程无需再传密码)
    list: (password?: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_LIST, password),
    // [w] 新增映射
    add: (entityType: string, text: string) =>
      ipcRenderer.invoke(IPC.IPC_PRIVACY_ADD, entityType, text),
    // [r] 匿名化
    anonymize: (text: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_ANONYMIZE, text),
    // [r] 反匿名化(使用主进程内存中已缓存的密码)
    deanonymize: (text: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_DEANONYMIZE, text),
    // [r] 按接收方过滤
    filter: (receiver: string, text: string) =>
      ipcRenderer.invoke(IPC.IPC_PRIVACY_FILTER, receiver, text),
    // [r] dry-run 预览
    dryrun: (text: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_DRYRUN, text),
    // [c] 备份映射(写文件到 destPath) — UI 层应二次确认
    backup: (destPath: string) => ipcRenderer.invoke(IPC.IPC_PRIVACY_BACKUP, destPath),
    // [w] 锁定(清空主进程内存中的密码,后续隐私操作需重新输入密码)
    lock: () => ipcRenderer.invoke(IPC.IPC_PRIVACY_LOCK),
    // [r] 查询隐私引擎状态(是否已加载密码,不返回密码本身)
    status: () => ipcRenderer.invoke(IPC.IPC_PRIVACY_STATUS),
  },

  // ----- 定时任务 -----
  cron: {
    // [r] 列出任务
    list: () => ipcRenderer.invoke(IPC.IPC_CRON_LIST),
    // [w] 新增任务
    add: (task: unknown) => ipcRenderer.invoke(IPC.IPC_CRON_ADD, task),
    // [w] 更新任务
    update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.IPC_CRON_UPDATE, id, patch),
    // [c] 删除任务 — UI 层应二次确认
    remove: (id: string) => ipcRenderer.invoke(IPC.IPC_CRON_REMOVE, id),
    // [w] 启停任务
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.IPC_CRON_TOGGLE, id, enabled),
    // [w] 立即执行
    runNow: (id: string) => ipcRenderer.invoke(IPC.IPC_CRON_RUN_NOW, id),
    // [r] 读取日志
    getLogs: (taskId?: string) => ipcRenderer.invoke(IPC.IPC_CRON_GET_LOGS, taskId),

    onStatusUpdate: (callback: (data: unknown) => void) => {
      const handler = (_e: unknown, data: unknown) => callback(data)
      ipcRenderer.on(IPC.IPC_CRON_STATUS_UPDATE, handler)
      return () => {
        ipcRenderer.removeListener(IPC.IPC_CRON_STATUS_UPDATE, handler)
      }
    },
  },

  // ----- 技能 -----
  skill: {
    // [r] 列出技能
    list: () => ipcRenderer.invoke(IPC.IPC_SKILL_LIST),
    // [r] 读取技能
    get: (name: string) => ipcRenderer.invoke(IPC.IPC_SKILL_GET, name),
    // [w] 写入技能
    save: (name: string, content: string) => ipcRenderer.invoke(IPC.IPC_SKILL_SAVE, name, content),
    // [c] 删除技能 — UI 层应二次确认
    delete: (name: string) => ipcRenderer.invoke(IPC.IPC_SKILL_DELETE, name),
  },

  // ----- 设置 -----
  settings: {
    // [r] 读取设置
    get: () => ipcRenderer.invoke(IPC.IPC_SETTINGS_GET),
    // [w] 更新设置(dotPath + value)
    set: (path: string, value: unknown) => ipcRenderer.invoke(IPC.IPC_SETTINGS_SET, path, value),
    // [c] 恢复默认 — UI 层应二次确认
    reset: () => ipcRenderer.invoke(IPC.IPC_SETTINGS_RESET),
  },

  // ----- 系统 -----
  sys: {
    // [r] 打开文件选择对话框
    openDialog: (options: unknown) => ipcRenderer.invoke(IPC.IPC_SYS_OPEN_DIALOG, options),
    // [r] 打开保存对话框
    saveDialog: (options: unknown) => ipcRenderer.invoke(IPC.IPC_SYS_SAVE_DIALOG, options),
    // [c] 打开外部 URL — 应校验协议(https:// only) + 二次确认
    openExternal: (url: string) => ipcRenderer.invoke(IPC.IPC_SYS_OPEN_EXTERNAL, url),
    // [r] 获取系统路径
    getPath: (name: string) => ipcRenderer.invoke(IPC.IPC_SYS_GET_PATH, name),
    // [r] 检查更新
    checkUpdate: () => ipcRenderer.invoke(IPC.IPC_SYS_CHECK_UPDATE),
    showUpdateDialog: () => ipcRenderer.invoke(IPC.IPC_SYS_SHOW_UPDATE_DIALOG),
    // [r] 系统通知
    notify: (title: string, body: string) =>
      ipcRenderer.invoke(IPC.IPC_SYS_NOTIFICATION, title, body),
    // [r] 读取文件内容(文本 utf-8 / 二进制 base64),用于文件上传
    //   安全限制: 文件大小 ≤ 10MB,自动推断 MIME 类型
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.IPC_SYS_READ_FILE, filePath),
  },

  // ----- 学生档案 -----
  profile: {
    // [r] 读取学生扩展档案
    get: (name: string) => ipcRenderer.invoke(IPC.IPC_PROFILE_GET, name),
    // [w] 写入学生扩展档案
    set: (name: string, data: unknown) => ipcRenderer.invoke(IPC.IPC_PROFILE_SET, name, data),
  },

  // ----- 班级管理（本地：存档/删除） -----
  class: {
    // [r] 列出所有班级
    list: () => ipcRenderer.invoke(IPC.IPC_CLASS_LIST),
    // [w] 新建班级
    create: (params: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_CREATE, params),
    // [w] 更新班级信息（名称/年级/备注/班主任）
    update: (id: string, fields: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_UPDATE, id, fields),
    // [w] 存档班级（标记隐藏，数据保留）
    archive: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_ARCHIVE, id),
    // [w] 恢复班级（取消存档）
    restore: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_RESTORE, id),
    // [c] 删除班级（仅删本地记录，学生保留）— UI 层应二次确认
    delete: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_DELETE, id),
    // [w] 调班：批量把学生分入班级
    assign: (params: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_ASSIGN, params),
    // [w] 调班：把学生移出班级（清空 class_id）
    removeStudent: (params: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_REMOVE, params),
  },

  // ----- 对话持久化 -----
  chat: {
    // [w] 保存对话消息到 SQLite
    saveMessage: (msg: {
      sessionId?: string
      role: string
      content: string
      thinking?: string
      toolCalls?: string
      timestamp: number
      provider?: string
      model?: string
      tokenInput?: number
      tokenOutput?: number
      cost?: number
    }) => ipcRenderer.invoke(IPC.IPC_CHAT_SAVE_MESSAGE, msg),
    // [r] 加载对话历史
    loadMessages: (sessionId?: string) => ipcRenderer.invoke(IPC.IPC_CHAT_LOAD_MESSAGES, sessionId),
    // [c] 删除会话 — UI 层应二次确认
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.IPC_CHAT_DELETE_SESSION, sessionId),
    // [r] 列出所有会话
    listSessions: () => ipcRenderer.invoke(IPC.IPC_CHAT_LIST_SESSIONS),
  },

  // ----- 日志系统 -----
  log: {
    // [r] 列日志文件
    list: () => ipcRenderer.invoke(IPC.IPC_LOG_LIST),
    // [r] 读 tail N 行
    read: (name: string, lines?: number) => ipcRenderer.invoke(IPC.IPC_LOG_READ, name, lines),
    // [c] 清空所有日志 — UI 层应二次确认
    clear: () => ipcRenderer.invoke(IPC.IPC_LOG_CLEAR),
    // [r] T3: level 过滤读 tail
    filter: (name: string, levels: string[], lines?: number) =>
      ipcRenderer.invoke(IPC.IPC_LOG_FILTER, name, levels, lines),
    // [r] T3: 文本搜索
    search: (name: string, query: string, lines?: number) =>
      ipcRenderer.invoke(IPC.IPC_LOG_SEARCH, name, query, lines),
    // [w] T3: 导出到本地路径
    export: (name: string, targetPath: string) =>
      ipcRenderer.invoke(IPC.IPC_LOG_EXPORT, name, targetPath),
    // [w] T3: 导出 + 原生保存对话框
    exportWithDialog: (name: string) => ipcRenderer.invoke(IPC.IPC_LOG_EXPORT_DIALOG, name),
    // [w] 渲染端 console 转发到主进程 logs/renderer-*.log
    forward: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) =>
      ipcRenderer.send(IPC.IPC_LOG_WRITE_RENDERER, level, msg),
  },

  // ----- 飞书集成 -----
  feishu: {
    // [w] 测试连接(返回 token 前 8 位 + 过期秒数) appSecret 从 keystore 读取
    test: (appId: string) => ipcRenderer.invoke(IPC.IPC_FEISHU_TEST, appId),
    // [r] 列 bitable 表
    listBitable: (appId: string, appToken: string) =>
      ipcRenderer.invoke(IPC.IPC_FEISHU_BITABLE, appId, appToken),
    // [c] 发文本消息
    send: (appId: string, userOpenId: string, text: string) =>
      ipcRenderer.invoke(IPC.IPC_FEISHU_SEND, appId, userOpenId, text),
    // [r] 查 token 缓存状态
    status: () => ipcRenderer.invoke(IPC.IPC_FEISHU_STATUS),
    // [w] T4: 手动触发一次 bitable 同步(graceful 降级)
    syncNow: (appId: string, appToken: string, tableId: string, fields: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC.IPC_FEISHU_SYNC_NOW, appId, appToken, tableId, fields),
  },
})
