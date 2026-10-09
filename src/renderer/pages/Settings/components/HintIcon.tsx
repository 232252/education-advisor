// =============================================================
// HintIcon — 字段提示图标(鼠标悬停显示 FIELD_HINT 中的说明)
// 与 SettingsFieldHint 字典耦合,仅在 Settings 页使用
// =============================================================

import { Info } from 'lucide-react'
import { useT } from '../../../i18n'

// 提示图标:有 hint 的字段显示一个小问号,鼠标悬停显示说明
export function HintIcon({ path }: { path: string }) {
  const { t } = useT()
  // 字段提示信息（鼠标悬停显示）
  // 所有字段已实现,不再需要 status 状态标识
  const FIELD_HINT: Record<string, string> = {
    'general.dataDir': t('settings.dataDir.desc', 'EAA 数据目录,首次启动自动生成'),
    'general.language': t(
      'page.settings.hint.language',
      'i18n 已接入,useT hook 自动响应切换 (部分静态文案需重启)',
    ),
    'general.autoUpdate': t('page.settings.hint.autoUpdate', '检查更新功能已接入'),
    'general.autoStart': t('page.settings.hint.autoStart', '同步写入系统登录项'),
    'general.minimizeToTray': t('page.settings.hint.minimizeToTray', '托盘将实时创建/销毁'),
    'general.logLevel': t('page.settings.hint.logLevel', '主进程日志级别实现完毕,运行时即时生效'),
    'chat.compaction.enabled': t(
      'settings.chat.compaction.desc',
      '历史超过模型窗口时先写摘要再继续。摘要失败就截断更早的消息，最近的原话保留',
    ),
    'chat.compaction.reserveTokens': t(
      'page.settings.hint.reserveTokens',
      '压缩触发余量：上下文还剩这么多 token 空位时开始压缩。实际不会低于 4096，也不会超过该模型窗口的 10%',
    ),
    'chat.compaction.keepRecentTokens': t(
      'settings.chat.compaction.keepRecent.desc',
      '压缩时强制保留的最近消息 token 数',
    ),
    'chat.steeringMode': t(
      'page.settings.hint.steeringMode',
      '回复进行中发来的消息先排队。「全部」在这轮结束后合成一条发出；「一次一个」每轮只发下一条',
    ),
    'chat.followUpMode': t(
      'page.settings.hint.followUpMode',
      '写进系统提示。「全部」时回答后可以连续追问；「一次一个」时每次最多问一个问题',
    ),
    'chat.showImages': t(
      'page.settings.hint.showImages',
      '关闭后，助手回复里的 Markdown 图片改为文字占位，当前对话立即生效',
    ),
    'chat.maxTokens': t(
      'page.settings.hint.maxTokens',
      '教师对话没单独指定时，作为 dsh 的输出上限。不会低于该模型目录里的上限',
    ),
    'feishu.appId': t('page.settings.hint.feishuAppId', '飞书开放平台应用 ID'),
    'feishu.appSecret': t('page.settings.hint.feishuAppSecret', '已加密保存(keystore)'),
    'feishu.userOpenId': t('page.settings.hint.userOpenId', '接收消息的用户 open_id'),
    'feishu.bitableSync.enabled': t(
      'page.settings.hint.bitableSyncEnabled',
      'cron-service.registerBitableSync 已接入',
    ),
    'feishu.bitableSync.syncInterval': t('page.settings.hint.syncInterval', '每 N 分钟一次'),
    'eaa.doctor': t('page.settings.hint.doctor', 'EAA 引擎环境健康检查'),
    'eaa.validate': t('page.settings.hint.validate', 'EAA 事件数据完整性验证'),
    'mcp.enabled': t('page.settings.hint.mcpEnabled', '启用后 Agent 可通过 MCP 协议接入外部工具'),
    'models.agentRuntime': t(
      'page.settings.hint.agentRuntimeBackend',
      '对话和批改都走 DeepSeek Harness。模型密钥在本应用里配置，启动 dsh 时注入。',
    ),
  }
  const hint = FIELD_HINT[path]
  if (!hint) return null
  return (
    <span
      className="inline-flex items-center justify-center text-gray-400 dark:text-gray-500 cursor-help transition-colors hover:text-blue-500 dark:hover:text-blue-400"
      title={hint}
      role="img"
      aria-label={t('page.settings.hint.aria', '提示')}
    >
      <Info size={13} strokeWidth={2.2} />
    </span>
  )
}
