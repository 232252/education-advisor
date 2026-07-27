// =============================================================
// HintIcon — 字段提示图标(鼠标悬停显示 FIELD_HINT 中的说明)
// 与 SettingsFieldHint 字典耦合,仅在 Settings 页使用
// =============================================================

// 字段提示信息（鼠标悬停显示）
// 所有字段已实现,不再需要 status 状态标识
const FIELD_HINT: Record<string, string> = {
  'general.dataDir': 'EAA 数据目录,首次启动自动生成',
  'general.language': 'i18n 已接入,useT hook 自动响应切换 (部分静态文案需重启)',
  'general.autoUpdate': '检查更新功能已接入',
  'general.autoStart': '同步写入系统登录项',
  'general.minimizeToTray': '托盘将实时创建/销毁',
  'general.logLevel': '主进程日志级别实现完毕,运行时即时生效',
  'chat.compaction.enabled': '上下文超长时自动压缩历史消息',
  'chat.compaction.reserveTokens': '压缩后保留的最小 token 数',
  'chat.compaction.keepRecentTokens': '压缩时强制保留的最近消息 token 数',
  'chat.steeringMode': 'Agent 运行时已读取并注入 system prompt',
  'chat.followUpMode': 'Agent 运行时已读取并注入 system prompt',
  'chat.showImages': 'ChatPage 已接入，设置后立即生效',
  'chat.maxTokens': 'pi-ai-service 已读取并传入 streamSimple',
  'feishu.appId': '飞书开放平台应用 ID',
  'feishu.appSecret': '已加密保存(keystore)',
  'feishu.userOpenId': '接收消息的用户 open_id',
  'feishu.bitableSync.enabled': 'cron-service.registerBitableSync 已接入',
  'feishu.bitableSync.syncInterval': '每 N 分钟一次',
  'eaa.doctor': 'EAA 引擎环境健康检查',
  'eaa.validate': 'EAA 事件数据完整性验证',
  'mcp.enabled': '启用后 Agent 可通过 MCP 协议接入外部工具',
}

// 提示图标:有 hint 的字段显示一个小问号,鼠标悬停显示说明
export function HintIcon({ path }: { path: string }) {
  const hint = FIELD_HINT[path]
  if (!hint) return null
  return (
    <span
      className="text-[10px] text-gray-400 dark:text-gray-500 cursor-help"
      title={hint}
      role="img"
      aria-label="提示"
    >
      ⓘ
    </span>
  )
}
