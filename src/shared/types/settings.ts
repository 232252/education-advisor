// =============================================================
// 设置类型 — 统一设置结构 (UnifiedSettings)
// =============================================================

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
  backup: {
    /** 定时自动备份开关(默认 false) */
    autoEnabled: boolean
    /** 自动备份间隔(小时,默认 24) */
    intervalHours: number
    /** 自动备份保留份数(超出自动清理最旧的,默认 7) */
    keep: number
    /** M33: cron 驱动的定时自动备份开关(默认 false) */
    autoBackupEnabled: boolean
    /** M33: 定时自动备份 cron 表达式(默认 '0 3 * * *' 每日 03:00) */
    autoBackupCron: string
    /** 上次自动备份时间(epoch ms,从未备份为 undefined) */
    lastAutoAt?: number
  }
  shortcuts: Record<string, string>
}
