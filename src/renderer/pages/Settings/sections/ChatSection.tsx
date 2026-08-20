// =============================================================
// 对话设置 Section — maxTokens / compaction / steering / followUp / showImages / 日志
// 8 个 SettingRow,compaction reserveTokens / keepRecentTokens 在 enabled=false 时禁用
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { useT } from '../../../i18n'
import { cn, INPUT_SM } from '../../../lib/ui-utils'
import { Section, SettingRow, ToggleSwitch } from '../components'

export interface ChatSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

export function ChatSection({ settings, onSave }: ChatSectionProps) {
  const { t } = useT()

  return (
    <Section title={t('settings.section.chat')}>
      <SettingRow
        label={t('settings.chat.maxTokens', '最大 Token 数')}
        path="chat.maxTokens"
        description={t(
          'settings.chat.maxTokens.desc',
          '单次对话上下文窗口大小,数值越大支持的上下文越长',
        )}
      >
        <input
          type="number"
          min={512}
          max={200000}
          step={512}
          value={settings.chat.maxTokens}
          onChange={(e) => onSave('chat.maxTokens', Number(e.target.value))}
          className={cn(INPUT_SM, 'w-28')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.chat.compaction', '自动压缩对话')}
        path="chat.compaction.enabled"
        description={t('settings.chat.compaction.desc', '上下文超长时自动压缩历史消息')}
      >
        <ToggleSwitch
          checked={settings.chat.compaction.enabled}
          onChange={(v) => onSave('chat.compaction.enabled', v)}
          label={t('settings.chat.compaction', '自动压缩对话')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.chat.compaction.reserve', '压缩保留 Token')}
        path="chat.compaction.reserveTokens"
        description={t('settings.chat.compaction.reserve.desc', '压缩后保留的最小上下文 token 数')}
      >
        <input
          type="number"
          min={256}
          max={32000}
          step={256}
          value={settings.chat.compaction.reserveTokens}
          onChange={(e) => onSave('chat.compaction.reserveTokens', Number(e.target.value))}
          className={cn(INPUT_SM, 'w-28')}
          disabled={!settings.chat.compaction.enabled}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.chat.compaction.keepRecent', '保留最近 Token')}
        path="chat.compaction.keepRecentTokens"
        description={t(
          'settings.chat.compaction.keepRecent.desc',
          '压缩时强制保留的最近消息 token 数',
        )}
      >
        <input
          type="number"
          min={256}
          max={32000}
          step={256}
          value={settings.chat.compaction.keepRecentTokens}
          onChange={(e) => onSave('chat.compaction.keepRecentTokens', Number(e.target.value))}
          className={cn(INPUT_SM, 'w-28')}
          disabled={!settings.chat.compaction.enabled}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.chat.steeringMode', '引导模式')}
        path="chat.steeringMode"
        description={t('settings.chat.steeringMode.desc', 'Agent 接受用户中途引导(steering)的方式')}
      >
        <select
          value={settings.chat.steeringMode}
          onChange={(e) => onSave('chat.steeringMode', e.target.value)}
          className={INPUT_SM}
        >
          <option value="all">{t('settings.chat.mode.all', '全部')}</option>
          <option value="one-at-a-time">{t('settings.chat.mode.oneAtATime', '一次一个')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.chat.followUpMode', '追问模式')}
        path="chat.followUpMode"
        description={t('settings.chat.followUpMode.desc', 'Agent 回答后追问用户的方式')}
      >
        <select
          value={settings.chat.followUpMode}
          onChange={(e) => onSave('chat.followUpMode', e.target.value)}
          className={INPUT_SM}
        >
          <option value="all">{t('settings.chat.mode.all', '全部')}</option>
          <option value="one-at-a-time">{t('settings.chat.mode.oneAtATime', '一次一个')}</option>
        </select>
      </SettingRow>

      <SettingRow
        label={t('settings.chat.showImages', '显示图片')}
        path="chat.showImages"
        description={t('settings.chat.showImages.desc', '在对话中渲染 Markdown 图片')}
      >
        <ToggleSwitch
          checked={settings.chat.showImages}
          onChange={(v) => onSave('chat.showImages', v)}
          label={t('settings.chat.showImages', '显示图片')}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.chat.conversationLogging', '对话日志记录')}
        path="chat.conversationLogging"
        description={t(
          'page.settings.chat.conversationLoggingDesc',
          '全量记录聊天流事件到 logs/chat-YYYY-MM-DD.log,含 in/out/event 三个方向',
        )}
      >
        <ToggleSwitch
          checked={settings.chat.conversationLogging}
          onChange={(v) => onSave('chat.conversationLogging', v)}
          label={t('settings.chat.conversationLogging', '对话日志记录')}
        />
      </SettingRow>
    </Section>
  )
}
