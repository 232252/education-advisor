// =============================================================
// Tauri 版 IPC 客户端 — 与 Electron 版 (ipc-client.ts) 接口签名完全一致。
//
// 这是 Tauri 重构的核心适配层。设计原则:
//   1. 11 个 React 页面 / 4 个 store 零改动 — 它们只 import getAPI()。
//   2. WindowAPI 接口签名 1:1 对齐 Electron 版 (ipc-client.ts)。
//   3. invoke('namespace_action', args) ← ipcRenderer.invoke('namespace:action', args)
//      命名规则: 冒号 → 下划线 (ai:list-models → ai_list_models)。
//   4. 流式事件 (8 个) ← listen('namespace:event', cb), 返回退订函数 (与原 unsubscribe 同构)。
//   5. 文件对话框/外链/通知/路径/更新 → Tauri 插件 (@tauri-apps/plugin-*) 或后端 command。
//
// 详见 src-tauri/docs/04-FRONTEND-SHIM.md。
// =============================================================

// 共享类型 (与 Electron 版同源)
import type {
  AcademicExamRecord,
  AddEventParams,
  AgentDetail,
  AgentListItem,
  CronLogEntry,
  CronTask,
  EAACodesData,
  EAADoctorData,
  EAAHistoryData,
  EAAInfoData,
  EAARangeData,
  EAARankItem,
  EAARankingData,
  EAAResult,
  EAASearchData,
  EAAStatsData,
  EAAStudentList,
  EAAStudentScore,
  EAASummaryData,
  EAATagDetailData,
  EAATagListData,
  EAAValidateData,
  ModelInfo,
  PrivacyMapping,
  ProviderInfo,
  SetStudentMetaParams,
  Skill,
  StreamEvent,
  StudentProfileData,
  TestConnectionResult,
  UnifiedSettings,
} from '@shared/types'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// =============================================================
// invoke / listen 的小工具
// =============================================================

/**
 * 把原 Electron 通道名规范化为 Tauri command 名。
 * 规则: 冒号 → 下划线, 连字符 → 下划线 (匹配 #[tauri::command] 的 snake_case 命名)。
 *   "ai:list-models"       → "ai_list_models"
 *   "agent:get-all-executions" → "agent_get_all_executions"
 *   "eaa:add-event"        → "eaa_add_event"
 */
function cmd(channel: string): string {
  return channel.replace(/[:-]/g, '_')
}

/** 订阅一个流式事件, 返回退订函数 (与 Electron 版 ipcRenderer.on 返回值同构)。 */
async function subscribe<T>(event: string, callback: (payload: T) => void): Promise<() => void> {
  const unlisten: UnlistenFn = await listen<T>(event, (e) => callback(e.payload))
  return () => {
    unlisten()
  }
}

// =============================================================
// WindowAPI — 与 Electron 版 ipc-client.ts 的 interface 逐字段对齐
// =============================================================
// (类型定义直接复用同一份, 保证页面/store 零改动。)

interface WindowAPI {
  ai: {
    listProviders: () => Promise<ProviderInfo[]>
    listModels: (providerId: string) => Promise<ModelInfo[]>
    testConnection: (
      providerId: string,
      apiKey: string,
      baseUrl?: string,
    ) => Promise<TestConnectionResult>
    setApiKey: (providerId: string, apiKey: string) => Promise<{ success: boolean }>
    deleteApiKey: (providerId: string) => Promise<{ success: boolean }>
    oauthLogin: (
      providerId: string,
    ) => Promise<{ success: boolean; error?: string; state?: string; providerId?: string }>
    oauthExchange: (
      code: string,
      oauthState: string,
      providerId: string,
    ) => Promise<{ success: boolean; providerId?: string; error?: string }>
    oauthListSupported: () => Promise<{
      providers: Array<{
        providerId: string
        supportsOAuth: boolean
        requiresClientSecret: boolean
      }>
    }>
    chat: (params: {
      providerId: string
      modelId: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
      thinking?: string
      maxTokens?: number
    }) => Promise<{ success: boolean; message: string; sessionId?: string }>
    abortChat: () => Promise<{ success: boolean }>
    addCustomModel: (params: {
      providerId: string
      modelId: string
      name?: string
      contextWindow?: number
      maxOutputTokens?: number
      supportsReasoning?: boolean
    }) => Promise<ModelInfo>
    deleteCustomModel: (providerId: string, modelId: string) => Promise<{ success: boolean }>
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
    }) => Promise<{ success: boolean }>
    onStream: (callback: (event: StreamEvent) => void) => () => void
  }
  agent: {
    list: () => Promise<AgentListItem[]>
    get: (id: string) => Promise<AgentDetail | null>
    toggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>
    update: (
      id: string,
      patch: Partial<{
        name: string
        description: string
        modelTier: 'high_quality' | 'low_cost'
        capabilities: string[]
        skillIds: string[]
      }>,
    ) => Promise<{ success: boolean; error?: string }>
    getSoul: (id: string) => Promise<string>
    setSoul: (id: string, content: string) => Promise<{ success: boolean }>
    getRules: (id: string) => Promise<string>
    setRules: (id: string, content: string) => Promise<{ success: boolean }>
    runManual: (
      id: string,
      prompt: string,
      history?: Array<{ role: string; content: string }>,
    ) => Promise<{ success: boolean; message?: string; id?: string }>
    getHistory: (id: string) => Promise<unknown[]>
    getAllExecutions: (options?: {
      status?: 'success' | 'error' | 'timeout'
      agentId?: string
      sinceMs?: number
      limit?: number
    }) => Promise<{
      executions: Array<{
        id: string
        agentId: string
        prompt: string
        output: string
        startedAt: number
        durationMs: number
        tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
        cost: number
        status: 'success' | 'error' | 'timeout'
      }>
      stats: {
        totalRuns: number
        successCount: number
        errorCount: number
        timeoutCount: number
        successRate: number
        totalCost: number
        totalTokens: number
        totalDurationMs: number
      }
      agentNameMap: Record<string, string>
    }>
    abort: (id: string) => Promise<{ success: boolean }>
    onStatusUpdate: (callback: (data: unknown) => void) => () => void
  }
  eaa: {
    info: () => Promise<EAAResult<EAAInfoData>>
    score: (name: string) => Promise<EAAResult<EAAStudentScore>>
    ranking: (n?: number) => Promise<EAAResult<EAARankingData>>
    replay: () => Promise<EAAResult<{ ranking: EAARankItem[] }>>
    addEvent: (params: AddEventParams) => Promise<EAAResult<string>>
    revertEvent: (eventId: string, reason: string) => Promise<EAAResult<string>>
    history: (name: string) => Promise<EAAResult<EAAHistoryData>>
    search: (query: string, limit?: number) => Promise<EAAResult<EAASearchData>>
    range: (start: string, end: string, limit?: number) => Promise<EAAResult<EAARangeData>>
    tag: (tag?: string) => Promise<EAAResult<EAATagListData | EAATagDetailData>>
    stats: () => Promise<EAAResult<EAAStatsData>>
    validate: () => Promise<EAAResult<EAAValidateData>>
    export: (format: string, outputFile?: string) => Promise<EAAResult<string>>
    listStudents: () => Promise<EAAResult<EAAStudentList>>
    addStudent: (name: string) => Promise<EAAResult<string>>
    deleteStudent: (
      name: string,
      options?: { confirm?: boolean; reason?: string },
    ) => Promise<EAAResult<string> & { requiresConfirmation?: boolean }>
    setStudentMeta: (params: SetStudentMetaParams) => Promise<EAAResult<string>>
    import: (filePath: string) => Promise<EAAResult<string>>
    codes: () => Promise<EAAResult<EAACodesData>>
    doctor: () => Promise<EAAResult<EAADoctorData>>
    summary: (since?: string, until?: string) => Promise<EAAResult<EAASummaryData>>
    dashboard: (outputDir?: string) => Promise<EAAResult<string>>
    onEventAdded: (
      callback: (data: {
        studentName: string
        reasonCode: string
        delta?: number
        at: number
      }) => void,
    ) => () => void
    onEventReverted: (callback: (data: { eventId: string; at: number }) => void) => () => void
    onStudentAdded: (callback: (data: { name: string; at: number }) => void) => () => void
    onStudentDeleted: (callback: (data: { name: string; at: number }) => void) => () => void
  }
  privacy: {
    init: (password: string, autoScan?: boolean) => Promise<EAAResult>
    load: (password: string) => Promise<EAAResult>
    enable: () => Promise<EAAResult>
    disable: (password: string) => Promise<EAAResult>
    list: (password: string) => Promise<EAAResult<PrivacyMapping[]>>
    add: (entityType: string, text: string) => Promise<EAAResult>
    anonymize: (text: string) => Promise<EAAResult>
    deanonymize: (text: string) => Promise<EAAResult>
    filter: (receiver: string, text: string) => Promise<EAAResult>
    dryrun: (text: string) => Promise<EAAResult>
    backup: (destPath: string) => Promise<EAAResult>
    onStateChanged: (callback: (data: { enabled: boolean; at: number }) => void) => () => void
  }
  compliance: {
    generate: (
      startMs: number,
      endMs: number,
      label?: string,
    ) => Promise<{ success: boolean; report?: unknown; error?: string }>
    list: () => Promise<{
      success: boolean
      auditLogLineCount: number
      previousQuarter: { start: number; end: number; label: string }
      currentQuarter: { start: number; end: number; label: string }
    }>
    save: (
      reportJson: string,
      destPath: string,
    ) => Promise<{ success: boolean; filePath?: string; bytes?: number; error?: string }>
    readAudit: (opts?: { limit?: number }) => Promise<{ success: boolean; entries: unknown[] }>
  }
  cron: {
    list: () => Promise<CronTask[]>
    add: (task: unknown) => Promise<string>
    update: (id: string, patch: unknown) => Promise<{ success: boolean }>
    remove: (id: string) => Promise<{ success: boolean }>
    toggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>
    runNow: (id: string) => Promise<{ success: boolean }>
    getLogs: (taskId?: string) => Promise<CronLogEntry[]>
    onStatusUpdate: (callback: (data: unknown) => void) => () => void
  }
  skill: {
    list: () => Promise<Skill[]>
    get: (name: string) => Promise<Skill | null>
    save: (name: string, content: string) => Promise<{ success: boolean }>
    delete: (name: string) => Promise<{ success: boolean; error?: string }>
    setEnabled: (name: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  }
  settings: {
    get: () => Promise<UnifiedSettings>
    set: (path: string, value: unknown) => Promise<{ success: boolean }>
    reset: () => Promise<{ success: boolean }>
  }
  profile: {
    get: (name: string) => Promise<{ success: boolean; data: StudentProfileData }>
    set: (
      name: string,
      data: Partial<StudentProfileData>,
    ) => Promise<{ success: boolean; error?: string }>
    validateAcademic: (
      records: AcademicExamRecord[],
    ) => Promise<{ success: boolean; errors?: string[] }>
  }
  chat: {
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
    }) => Promise<{ success: boolean; id?: number }>
    loadMessages: (
      sessionId?: string,
    ) => Promise<{ success: boolean; messages: Array<Record<string, unknown>> }>
    deleteSession: (sessionId: string) => Promise<{ success: boolean }>
    listSessions: () => Promise<{
      success: boolean
      sessions: Array<{ id: string; title: string; createdAt: number; messageCount: number }>
    }>
  }
  log: {
    list: () => Promise<Array<{ stream: string; date: string; name: string; sizeBytes: number }>>
    read: (name: string, lines?: number) => Promise<string>
    clear: () => Promise<number>
    filter: (name: string, levels: string[], lines?: number) => Promise<string>
    search: (name: string, query: string, lines?: number) => Promise<string>
    export: (name: string, targetPath: string) => Promise<number>
    exportWithDialog: (name: string) => Promise<{ canceled: boolean; bytes: number; path?: string }>
    forward: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
  }
  feishu: {
    test: (
      appId: string,
    ) => Promise<{ success: boolean; token?: string; expireSec?: number; error?: string }>
    listBitable: (
      appId: string,
      appToken: string,
    ) => Promise<{
      success: boolean
      tables?: Array<{ table_id: string; name: string }>
      error?: string
    }>
    send: (
      appId: string,
      userOpenId: string,
      text: string,
    ) => Promise<{ success: boolean; messageId?: string; error?: string }>
    sendPreflight: (
      appId: string,
      userOpenId: string,
      text: string,
    ) => Promise<{
      hasPII: boolean
      entities: Array<{ kind: string; count: number }>
      redacted: string
      original: string
      originalLength: number
      privacyEnabled: boolean
      error?: string
    }>
    sendConfirm: (
      appId: string,
      userOpenId: string,
      text: string,
      decision: 'cancel' | 'redacted' | 'original',
    ) => Promise<{
      success: boolean
      messageId?: string
      error?: string
      blocked?: boolean
      report?: {
        hasPII: boolean
        entities: Array<{ kind: string; count: number }>
        privacyEnabled: boolean
      }
      sentTextLength?: number
    }>
    status: () => Promise<string>
    syncNow: (
      appId: string,
      appToken: string,
      tableId: string,
      fields: Record<string, unknown>,
    ) => Promise<{
      success: boolean
      skipped?: string
      recordId?: string
      error?: string
      piiReport?: {
        hasPII: boolean
        entities: Array<{ kind: string; count: number }>
        privacyEnabled: boolean
      }
    }>
  }
  sys: {
    openDialog: (options: unknown) => Promise<unknown>
    saveDialog: (options: unknown) => Promise<unknown>
    openExternal: (url: string) => Promise<{ success: boolean }>
    getPath: (name: string) => Promise<string>
    checkUpdate: () => Promise<{
      hasUpdate: boolean
      currentVersion: string
      latestVersion: string
      releaseUrl: string
      releaseNotes: string
      message: string
    }>
    showUpdateDialog: () => Promise<{ success: boolean }>
    notify: (title: string, body: string) => Promise<{ success: boolean }>
    resetFactory: () => Promise<{ success: boolean; message: string }>
    deleteByClass: (
      classId: string,
    ) => Promise<{ success: boolean; message: string; deleted?: number }>
    deleteStudentByName: (name: string) => Promise<{ success: boolean; message: string }>
    resetEventsOnly: () => Promise<{ success: boolean; message: string }>
  }
}

// =============================================================
// Tauri 版 WindowAPI 实现 — 全部走 invoke + listen
// =============================================================

function buildTauriAPI(): WindowAPI {
  return {
    // ----- AI -----
    ai: {
      listProviders: () => invoke<ProviderInfo[]>(cmd('ai:list-providers')),
      listModels: (providerId) => invoke<ModelInfo[]>(cmd('ai:list-models'), { providerId }),
      testConnection: (providerId, apiKey, baseUrl) =>
        invoke<TestConnectionResult>(cmd('ai:test-connection'), { providerId, apiKey, baseUrl }),
      setApiKey: (providerId, apiKey) =>
        invoke<{ success: boolean }>(cmd('ai:set-api-key'), { providerId, apiKey }),
      deleteApiKey: (providerId) =>
        invoke<{ success: boolean }>(cmd('ai:delete-api-key'), { providerId }),
      oauthLogin: (providerId) =>
        invoke<{ success: boolean; error?: string; state?: string; providerId?: string }>(
          cmd('ai:oauth-login'),
          { providerId },
        ),
      oauthExchange: (code, oauthState, providerId) =>
        invoke<{ success: boolean; providerId?: string; error?: string }>(
          cmd('ai:oauth-exchange'),
          { code, oauthState, providerId },
        ),
      oauthListSupported: () =>
        invoke<{
          providers: Array<{
            providerId: string
            supportsOAuth: boolean
            requiresClientSecret: boolean
          }>
        }>(cmd('ai:oauth-list-supported')),
      chat: (params) =>
        invoke<{ success: boolean; message: string; sessionId?: string }>(cmd('ai:chat'), {
          params,
        }),
      abortChat: () => invoke<{ success: boolean }>(cmd('ai:chat-abort')),
      addCustomModel: (params) => invoke<ModelInfo>(cmd('ai:add-custom-model'), { params }),
      deleteCustomModel: (providerId, modelId) =>
        invoke<{ success: boolean }>(cmd('ai:del-custom-model'), { providerId, modelId }),
      updateCustomModel: (params) =>
        invoke<{ success: boolean }>(cmd('ai:update-custom-model'), { params }),
      onStream: (callback) => {
        // subscribe 返回 Promise<unlisten>; 立即返回一个 lazy 退订函数, 保持同步签名
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe<StreamEvent>('ai:chat-stream', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
    },

    // ----- Agent -----
    agent: {
      list: () => invoke<AgentListItem[]>(cmd('agent:list')),
      get: (id) => invoke<AgentDetail | null>(cmd('agent:get'), { id }),
      toggle: (id, enabled) => invoke<{ success: boolean }>(cmd('agent:toggle'), { id, enabled }),
      update: (id, patch) =>
        invoke<{ success: boolean; error?: string }>(cmd('agent:update'), { id, patch }),
      getSoul: (id) => invoke<string>(cmd('agent:get-soul'), { id }),
      setSoul: (id, content) =>
        invoke<{ success: boolean }>(cmd('agent:set-soul'), { id, content }),
      getRules: (id) => invoke<string>(cmd('agent:get-rules'), { id }),
      setRules: (id, content) =>
        invoke<{ success: boolean }>(cmd('agent:set-rules'), { id, content }),
      runManual: (id, prompt, history) =>
        invoke<{ success: boolean; message?: string; id?: string }>(cmd('agent:run-manual'), {
          id,
          prompt,
          history,
        }),
      getHistory: (id) => invoke<unknown[]>(cmd('agent:get-history'), { id }),
      getAllExecutions: (options) =>
        invoke(cmd('agent:get-all-executions'), {
          opts: options ?? null,
        }),
      abort: (id) => invoke<{ success: boolean }>(cmd('agent:abort'), { id }),
      onStatusUpdate: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('agent:status-update', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
    },

    // ----- EAA -----
    eaa: {
      info: () => invoke(cmd('eaa:info')),
      score: (name) => invoke(cmd('eaa:score'), { name }),
      ranking: (n) => invoke(cmd('eaa:ranking'), { n: n ?? 10 }),
      replay: () => invoke(cmd('eaa:replay')),
      addEvent: (params) => invoke(cmd('eaa:add-event'), { params }),
      revertEvent: (eventId, reason) => invoke(cmd('eaa:revert-event'), { eventId, reason }),
      history: (name) => invoke(cmd('eaa:history'), { name }),
      search: (query, limit) => invoke(cmd('eaa:search'), { query, limit }),
      range: (start, end, limit) => invoke(cmd('eaa:range'), { start, end, limit }),
      tag: (tag) => invoke(cmd('eaa:tag'), { tag: tag ?? null }),
      stats: () => invoke(cmd('eaa:stats')),
      validate: () => invoke(cmd('eaa:validate')),
      export: (format, outputFile) => invoke(cmd('eaa:export'), { format, outputFile }),
      listStudents: () => invoke(cmd('eaa:list-students')),
      addStudent: (name) => invoke(cmd('eaa:add-student'), { name }),
      deleteStudent: (name, options) =>
        invoke(cmd('eaa:delete-student'), {
          name,
          args: { confirm: options?.confirm ?? true, reason: options?.reason },
        }),
      setStudentMeta: (params) => invoke(cmd('eaa:set-student-meta'), { params }),
      import: (filePath) => invoke(cmd('eaa:import'), { filePath }),
      codes: () => invoke(cmd('eaa:codes')),
      doctor: () => invoke(cmd('eaa:doctor')),
      summary: (since, until) => invoke(cmd('eaa:summary'), { since, until }),
      dashboard: (outputDir) => invoke(cmd('eaa:dashboard'), { outputDir }),
      onEventAdded: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('eaa:event-added', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
      onEventReverted: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('eaa:event-reverted', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
      onStudentAdded: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('eaa:student-added', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
      onStudentDeleted: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('eaa:student-deleted', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
    },

    // ----- Privacy -----
    privacy: {
      init: (password, autoScan) =>
        invoke(cmd('privacy:init'), { password, autoScan: autoScan ?? false }),
      load: (password) => invoke(cmd('privacy:load'), { password }),
      enable: () => invoke(cmd('privacy:enable')),
      disable: (password) => invoke(cmd('privacy:disable'), { password }),
      list: (password) => invoke(cmd('privacy:list'), { password }),
      add: (entityType, text) => invoke(cmd('privacy:add'), { entityType, text }),
      anonymize: (text) => invoke(cmd('privacy:anonymize'), { text }),
      deanonymize: (text) => invoke(cmd('privacy:deanonymize'), { text }),
      filter: (receiver, text) => invoke(cmd('privacy:filter'), { receiver, text }),
      dryrun: (text) => invoke(cmd('privacy:dryrun'), { text }),
      backup: (destPath) => invoke(cmd('privacy:backup'), { destPath }),
      onStateChanged: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('privacy:state-changed', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
    },

    // ----- Compliance -----
    compliance: {
      generate: (startMs, endMs, label) =>
        invoke(cmd('compliance:generate'), { startMs, endMs, label }),
      list: () => invoke(cmd('compliance:list')),
      save: (reportJson, destPath) => invoke(cmd('compliance:save'), { reportJson, destPath }),
      readAudit: (opts) => invoke(cmd('compliance:read-audit'), { opts: opts ?? null }),
    },

    // ----- Cron -----
    cron: {
      list: () => invoke<CronTask[]>(cmd('cron:list')),
      add: (task) => invoke<string>(cmd('cron:add'), { task }),
      update: (id, patch) => invoke<{ success: boolean }>(cmd('cron:update'), { id, patch }),
      remove: (id) => invoke<{ success: boolean }>(cmd('cron:remove'), { id }),
      toggle: (id, enabled) => invoke<{ success: boolean }>(cmd('cron:toggle'), { id, enabled }),
      runNow: (id) => invoke<{ success: boolean }>(cmd('cron:run-now'), { id }),
      getLogs: (taskId) => invoke<CronLogEntry[]>(cmd('cron:get-logs'), { taskId }),
      onStatusUpdate: (callback) => {
        let unlisten: (() => void) | null = null
        let cancelled = false
        subscribe('cron:status-update', callback).then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        return () => {
          cancelled = true
          unlisten?.()
        }
      },
    },

    // ----- Skill -----
    skill: {
      list: () => invoke<Skill[]>(cmd('skill:list')),
      get: (name) => invoke<Skill | null>(cmd('skill:get'), { name }),
      save: (name, content) => invoke<{ success: boolean }>(cmd('skill:save'), { name, content }),
      delete: (name) => invoke<{ success: boolean; error?: string }>(cmd('skill:delete'), { name }),
      setEnabled: (name, enabled) =>
        invoke<{ success: boolean; error?: string }>(cmd('skill:set-enabled'), { name, enabled }),
    },

    // ----- Settings -----
    settings: {
      get: () => invoke<UnifiedSettings>(cmd('settings:get')),
      set: (path, value) => invoke<{ success: boolean }>(cmd('settings:set'), { path, value }),
      reset: () => invoke<{ success: boolean }>(cmd('settings:reset')),
    },

    // ----- Profile -----
    profile: {
      get: (name) => invoke(cmd('profile:get'), { name }),
      set: (name, data) => invoke(cmd('profile:set'), { name, data }),
      validateAcademic: (records) => invoke(cmd('profile:validate-academic'), { records }),
    },

    // ----- Chat -----
    chat: {
      saveMessage: (msg) => invoke(cmd('chat:save-message'), { msg }),
      loadMessages: (sessionId) => invoke(cmd('chat:load-messages'), { sessionId }),
      deleteSession: (sessionId) => invoke(cmd('chat:delete-session'), { sessionId }),
      listSessions: () => invoke(cmd('chat:list-sessions')),
    },

    // ----- Log -----
    log: {
      list: () => invoke(cmd('log:list')),
      read: (name, lines) => invoke<string>(cmd('log:read'), { name, lines }),
      clear: () => invoke<number>(cmd('log:clear')),
      filter: (name, levels, lines) => invoke<string>(cmd('log:filter'), { name, levels, lines }),
      search: (name, query, lines) => invoke<string>(cmd('log:search'), { name, query, lines }),
      export: (name, targetPath) => invoke<number>(cmd('log:export'), { name, targetPath }),
      exportWithDialog: (name) => invoke(cmd('log:export-dialog'), { name }),
      // send (fire-and-forget): invoke 同样可行, 后端不阻塞
      forward: (level, msg) => {
        invoke(cmd('log:write-renderer'), { level, msg }).catch(() => {
          /* 忽略, forward 是 best-effort */
        })
      },
    },

    // ----- Feishu -----
    feishu: {
      test: (appId) => invoke(cmd('feishu:test'), { appId }),
      listBitable: (appId, appToken) => invoke(cmd('feishu:bitable'), { appId, appToken }),
      send: (appId, userOpenId, text) => invoke(cmd('feishu:send'), { appId, userOpenId, text }),
      sendPreflight: (appId, userOpenId, text) =>
        invoke(cmd('feishu:send-preflight'), { appId, userOpenId, text }),
      sendConfirm: (appId, userOpenId, text, decision) =>
        invoke(cmd('feishu:send-confirm'), {
          appId,
          userOpenId,
          text,
          args: { decision },
        }),
      status: () => invoke<string>(cmd('feishu:status')),
      syncNow: (appId, appToken, tableId, fields) =>
        invoke(cmd('feishu:sync-now'), { appId, appToken, tableId, fields }),
    },

    // ----- Sys -----
    sys: {
      openDialog: (options) => invoke(cmd('sys:open-dialog'), { options }),
      saveDialog: (options) => invoke(cmd('sys:save-dialog'), { options }),
      openExternal: (url) => invoke<{ success: boolean }>(cmd('sys:open-external'), { url }),
      getPath: (name) => invoke<string>(cmd('sys:get-path'), { name }),
      checkUpdate: () => invoke(cmd('sys:check-update')),
      showUpdateDialog: () => invoke<{ success: boolean }>(cmd('sys:show-update-dialog')),
      notify: (title, body) =>
        invoke<{ success: boolean }>(cmd('sys:notification'), { title, body }),
      resetFactory: () => invoke<{ success: boolean; message: string }>(cmd('sys:reset-factory')),
      deleteByClass: (classId) =>
        invoke<{ success: boolean; message: string; deleted?: number }>(
          cmd('sys:delete-by-class'),
          {
            classId,
          },
        ),
      deleteStudentByName: (name) =>
        invoke<{ success: boolean; message: string }>(cmd('sys:delete-student-by-name'), { name }),
      resetEventsOnly: () =>
        invoke<{ success: boolean; message: string }>(cmd('sys:reset-events-only')),
    },
  }
}

// =============================================================
// 运行时探测: Tauri vs Electron
// =============================================================

// Tauri 注入 '__TAURI_INTERNALS__' (2.x) 或 '__TAURI__' (1.x) 到 window。
function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    // @ts-expect-error 运行时探测, 编译期不存在该字段
    (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined)
  )
}

// 单例 (避免每次 getAPI 重建 90+ 闭包)
let _tauriAPI: WindowAPI | null = null

/** 获取 API 客户端 (Tauri 版)。与 Electron 版 ipc-client.ts 的 getAPI() 签名一致。 */
export function getAPI(): WindowAPI {
  if (!isTauri()) {
    throw new Error(
      '当前运行在非 Tauri 环境。请用 npm run tauri:dev 启动, 或回到 Electron 版 getAPI()',
    )
  }
  if (!_tauriAPI) _tauriAPI = buildTauriAPI()
  return _tauriAPI
}

// re-export 保持与 Electron 版文件导出一致
export { getErrorMessage } from '../../shared/utils'
