// =============================================================
// 对话设置 Section — maxTokens / compaction / steering / followUp / showImages / 日志
// 8 个 SettingRow,compaction reserveTokens / keepRecentTokens 在 enabled=false 时禁用
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useT } from '../../../i18n'
import { NumberSettingRow, Section, SelectSettingRow, ToggleSettingRow } from '../components'

interface ChatSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function ChatSection({ settings, onSave }: ChatSectionProps) {
  const { t } = useT()

  return (
    <Section title={t('settings.section.chat')}>
      <NumberSettingRow
        path="chat.maxTokens"
        label={t('settings.chat.maxTokens', '最大 Token 数')}
        description={t(
          'settings.chat.maxTokens.desc',
          '单次回复的输出上限。低于模型自带上限时仍用模型的上限，避免长回复被截断',
        )}
        value={settings.chat.maxTokens}
        min={512}
        max={200000}
        step={512}
        width="w-28"
        onSave={onSave}
      />

      <ToggleSettingRow
        path="chat.compaction.enabled"
        label={t('settings.chat.compaction', '自动压缩对话')}
        description={t(
          'settings.chat.compaction.desc',
          '历史超过模型窗口时先写摘要再继续。摘要失败就截断更早的消息，最近的原话保留',
        )}
        value={settings.chat.compaction.enabled}
        onSave={onSave}
      />

      <NumberSettingRow
        path="chat.compaction.reserveTokens"
        label={t('settings.chat.compaction.reserve', '压缩触发余量')}
        description={t(
          'settings.chat.compaction.reserve.desc',
          '上下文还剩这么多 token 空位时开始压缩。实际不会低于 4096，也不会超过该模型窗口的 10%',
        )}
        value={settings.chat.compaction.reserveTokens}
        min={256}
        max={32000}
        step={256}
        width="w-28"
        onSave={onSave}
        disabled={!settings.chat.compaction.enabled}
      />

      <NumberSettingRow
        path="chat.compaction.keepRecentTokens"
        label={t('settings.chat.compaction.keepRecent', '保留最近 Token')}
        description={t(
          'settings.chat.compaction.keepRecent.desc',
          '压缩时强制保留的最近消息 token 数',
        )}
        value={settings.chat.compaction.keepRecentTokens}
        min={256}
        max={32000}
        step={256}
        width="w-28"
        onSave={onSave}
        disabled={!settings.chat.compaction.enabled}
      />

      <SelectSettingRow
        path="chat.steeringMode"
        label={t('settings.chat.steeringMode', '引导模式')}
        description={t(
          'settings.chat.steeringMode.desc',
          '回复进行中发来的消息先排队。「全部」在这轮结束后合成一条发出；「一次一个」每轮只发下一条',
        )}
        value={settings.chat.steeringMode}
        options={[
          { value: 'all', label: t('settings.chat.mode.all', '全部') },
          { value: 'one-at-a-time', label: t('settings.chat.mode.oneAtATime', '一次一个') },
        ]}
        onSave={onSave}
      />

      <SelectSettingRow
        path="chat.followUpMode"
        label={t('settings.chat.followUpMode', '追问模式')}
        description={t(
          'settings.chat.followUpMode.desc',
          '写进系统提示。「全部」时回答后可以连续追问；「一次一个」时每次最多问一个问题',
        )}
        value={settings.chat.followUpMode}
        options={[
          { value: 'all', label: t('settings.chat.mode.all', '全部') },
          { value: 'one-at-a-time', label: t('settings.chat.mode.oneAtATime', '一次一个') },
        ]}
        onSave={onSave}
      />

      <ToggleSettingRow
        path="chat.showImages"
        label={t('settings.chat.showImages', '显示图片')}
        description={t(
          'settings.chat.showImages.desc',
          '关闭后，助手回复里的 Markdown 图片改为文字占位，当前对话立即生效',
        )}
        value={settings.chat.showImages}
        onSave={onSave}
      />

      <ToggleSettingRow
        path="chat.conversationLogging"
        label={t('settings.chat.conversationLogging', '对话日志记录')}
        description={t(
          'page.settings.chat.conversationLoggingDesc',
          '教师对话和成绩录入等直连回复写入 logs/chat-YYYY-MM-DD.log：提问为 in，回复文本为 out，工具调用为 event。关闭后不再写入。',
        )}
        value={settings.chat.conversationLogging}
        onSave={onSave}
      />
    </Section>
  )
}
