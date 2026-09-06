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
          '单次对话上下文窗口大小,数值越大支持的上下文越长',
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
        description={t('settings.chat.compaction.desc', '上下文超长时自动压缩历史消息')}
        value={settings.chat.compaction.enabled}
        onSave={onSave}
      />

      <NumberSettingRow
        path="chat.compaction.reserveTokens"
        label={t('settings.chat.compaction.reserve', '压缩保留 Token')}
        description={t('settings.chat.compaction.reserve.desc', '压缩后保留的最小上下文 token 数')}
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
        description={t('settings.chat.steeringMode.desc', 'Agent 接受用户中途引导(steering)的方式')}
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
        description={t('settings.chat.followUpMode.desc', 'Agent 回答后追问用户的方式')}
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
        description={t('settings.chat.showImages.desc', '在对话中渲染 Markdown 图片')}
        value={settings.chat.showImages}
        onSave={onSave}
      />

      <ToggleSettingRow
        path="chat.conversationLogging"
        label={t('settings.chat.conversationLogging', '对话日志记录')}
        description={t(
          'page.settings.chat.conversationLoggingDesc',
          '全量记录聊天流事件到 logs/chat-YYYY-MM-DD.log,含 in/out/event 三个方向',
        )}
        value={settings.chat.conversationLogging}
        onSave={onSave}
      />
    </Section>
  )
}
