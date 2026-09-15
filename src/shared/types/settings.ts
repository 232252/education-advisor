// =============================================================
// 设置类型 — 统一设置结构 (UnifiedSettings)
// =============================================================

export interface UnifiedSettings {
  general: {
    /** 当前 EAA 数据目录(供展示;启动时若为空自动填默认值,解析统一走 paths.ts) */
    dataDir: string
    theme: 'dark' | 'light' | 'system'
    language: 'zh-CN' | 'en-US'
    autoUpdate: boolean
    updateUrl: string
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
    /**
     * 定时任务总开关。false 时所有 cron 触发跳过(手动「立即执行」仍可用)。
     * 默认 true 兼容旧用户;引导仪可把它关掉以免一上来就烧 Token。
     */
    schedulerEnabled: boolean
    /**
     * 本机 WebUI: off 关闭 / always 长开 / scheduled 定时开。
     */
    webUiMode: 'off' | 'always' | 'scheduled'
    /** WebUI 端口(实际占用时顺延) */
    webUiPort: number
    /** 定时开: 开始时刻 HH:mm */
    webUiScheduleStart: string
    /** 定时开: 结束时刻 HH:mm(小于开始则跨午夜) */
    webUiScheduleEnd: string
    /** 定时开: 星期几, 0=周日 … 6=周六 */
    webUiScheduleDays: number[]
    /** http 明文 或 https（默认 https，TLS 1.2+） */
    webUiProtocol: 'http' | 'https'
    /** 仅本机 / 局域网私网+同前缀 IPv6 / 全部接口 */
    webUiBind: 'loopback' | 'lan' | 'all'
    /** 是否同时监听 IPv6 */
    webUiIpv6: boolean
    /** 高级: 局域网 HTTPS 用的证书路径(空则自签) */
    webUiTlsCertPath: string
    /** 高级: 局域网 HTTPS 用的私钥路径 */
    webUiTlsKeyPath: string
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
  // AI 批改作业子系统的模型配置(需视觉能力;空 = 跟随高质量模型)
  grading: {
    provider: string
    model: string
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
    /** 定时任务(周报/风险预警等)完成后把结果推送给教师,默认关闭 */
    agentPushEnabled: boolean
  }
  /**
   * 消息频道(阶段 1 频道化):每渠道一段,键 = 渠道 manifest.id。
   * 凭证协议:secret 类字段只存 keystore,settings.json 里恒为空串,
   * settings:get 响应用 '__keystore__' 占位符回显。
   * appId/domain 与 feishu.*(出站集成共用凭证)保持镜像(见 settings:set)。
   */
  channels: {
    feishu: {
      /** 连接开关(与运行状态正交) */
      enabled: boolean
      domain: 'feishu' | 'lark'
      appId: string
      /** 恒为空串或 '__keystore__' 占位符(真实值在 keystore 'feishu-app-secret') */
      appSecret: string
      /** 群聊响应(需 @机器人);关闭后只处理私聊 */
      allowGroups: boolean
      /** 该频道的消息交给哪个 Agent 处理(避免多渠道抢占 main 队列) */
      agentId: string
      /** QwenPaw ACL / debounce(可选;缺省 open + requireMention) */
      allowFrom?: string
      aclDm?: string
      aclGroup?: string
      requireMention?: boolean
      debounceMs?: number
    }
    dingtalk: {
      /** 连接开关(与运行状态正交) */
      enabled: boolean
      clientId: string
      /** 恒为空串或 '__keystore__' 占位符(真实值在 keystore 'dingtalk-client-secret') */
      clientSecret: string
      /** 群聊响应(群内需 @机器人);关闭后只处理私聊 */
      allowGroups: boolean
      /** 该频道的消息交给哪个 Agent 处理(避免多渠道抢占 main 队列) */
      agentId: string
      /** AI 卡片模板 ID;空 = 官方公共模板 */
      cardTemplateId: string
    }
    wecom: {
      /** 连接开关(与运行状态正交) */
      enabled: boolean
      /** 智能机器人 bot_id(管理端可见) */
      botId: string
      /** 恒为空串或 '__keystore__' 占位符(真实值在 keystore 'wecom-secret') */
      secret: string
      /** 群聊响应;关闭后只处理单聊 */
      allowGroups: boolean
      /** 该频道的消息交给哪个 Agent 处理(避免多渠道抢占 main 队列) */
      agentId: string
    }
    weixin: {
      enabled: boolean
      /** iLink API 基址(扫码后可能覆盖) */
      baseUrl: string
      /** 恒为空串或 '__keystore__'(真实值在 keystore 'weixin-bot-token') */
      botToken: string
      agentId: string
    }
    qq: {
      enabled: boolean
      appId: string
      /** 恒为空串或 '__keystore__'(真实值在 keystore 'qq-client-secret') */
      clientSecret: string
      allowGroups: boolean
      agentId: string
    }
  }
  // R2-03 清理:原 advanced.shellPath/sessionDir/httpIdleTimeoutMs 为死配置(全仓无消费方),已删除
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
