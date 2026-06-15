// =============================================================
// IPC 客户端封装 — 类型安全的 window.api 调用
// =============================================================

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
// Tauri 版 IPC 客户端 — 仅在 __TAURI_INTERNALS__ 存在时由 getAPI() 委托调用。
// 顶层静态 import (非 require): Vite/WebView 是 ESM 环境, require 未定义会白屏。
// Electron 构建会引入 @tauri-apps/api, 但运行时不执行 (条件不满足就不调用)。
import { getAPI as getTauriAPI } from './ipc-client.tauri'

// window.api 的类型声明（与 preload 脚本对应）
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
    ) => Promise<{ success: boolean; error?: string; authUrl?: string }>
    chat: (params: {
      providerId: string
      modelId: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
      thinking?: string
      maxTokens?: number
    }) => Promise<{ success: boolean; message: string }>
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
    // P3: 已绑定 skills 通过 getAgent() 返回的 skillIds 配合 skill.list() 自行组合, 不再单独暴露
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
    abort: (id: string) => Promise<{ success: boolean }>
    // P6: 跨 agent 查询所有执行历史 + 统计
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

    // P2-5: EAA 数据变更广播监听 — 让页面在事件写入后实时刷新
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
    // P1-11: 订阅隐私引擎状态变化（enable/disable 切换），用于全局 UI 同步
    onStateChanged: (callback: (data: { enabled: boolean; at: number }) => void) => () => void
  }
  // Pillar 6: 合规报告
  compliance: {
    generate: (
      startMs: number,
      endMs: number,
      label?: string,
    ) => Promise<{
      success: boolean
      report?: {
        schemaVersion: number
        reportId: string
        generatedAt: number
        period: { start: number; end: number; label: string }
        summary: {
          totalCalls: number
          successCalls: number
          failedCalls: number
          anonymizeCalls: number
          deanonymizeCalls: number
          filterCalls: number
          dryRunCalls: number
          configCalls: number
          avgDurationMs: number
        }
        byOp: Record<string, number>
        byRecipient: Record<string, number>
        byEntityType: Record<string, number>
        piiStats: {
          totalPIIHits: number
          callsWithPII: number
          byKind: Record<string, number>
        }
        manifest: {
          auditLogSha256: string
          reportSha256: string
          auditLogLineCount: number
          generatedAt: number
        }
      }
      error?: string
    }>
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
    readAudit: (opts?: { limit?: number }) => Promise<{
      success: boolean
      entries: Array<{
        ts: number
        op: string
        inputLen: number
        outputLen: number
        hasPII: boolean
        piiCount: number
        receiver?: string
        entityType?: string
        durationMs: number
        success: boolean
        error?: string
      }>
    }>
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
    // P7: 启用/禁用 skill
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
  // T5: 日志系统 API
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
  // T7: 飞书集成 API (appSecret 从 keystore 读取，不再通过参数传递)
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
    // U-10: 飞书发送(带隐私预检)
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
      // U-12: bitable 写入的隐私预检报告
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

// 全局类型扩展
declare global {
  interface Window {
    api: WindowAPI
  }
}

/**
 * 获取 API 客户端（带安全检查）。
 *
 * Tauri 重构: 若运行在 Tauri 环境 (window.__TAURI_INTERNALS__ 由 Tauri 2.x 注入),
 * 透明委托给 Tauri 版实现 (ipc-client.tauri.ts), 业务代码零改动。
 * 否则回退到 Electron 的 window.api。详见 src-tauri/docs/04-FRONTEND-SHIM.md。
 *
 * 注: 必须用顶层静态 import, 不能用 require() — Vite/WebView 是 ESM 环境,
 * require 未定义会导致 Tauri 模式白屏。@tauri-apps/api 在 Electron 构建里
 * 虽被引入但不会执行 (getAPI 只在 __TAURI_INTERNALS__ 存在时才委托)。
 */
export function getAPI(): WindowAPI {
  // Tauri 优先: __TAURI_INTERNALS__ 由 Tauri 2.x 注入到 window
  // @ts-expect-error 运行时探测, 编译期不存在该字段
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
    return getTauriAPI() as WindowAPI
  }
  if (!window.api) {
    throw new Error('window.api is not available. Are you running inside Electron?')
  }
  return window.api
}

/**
 * B-22: getErrorMessage 统一在 shared/utils.ts, 这里 re-export 保持兼容
 * @see ../../shared/utils
 */
export { getErrorMessage } from '../../shared/utils'
