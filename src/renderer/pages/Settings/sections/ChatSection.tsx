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
        label="最大 Token 数"
        path="chat.maxTokens"
        description="单次对话上下文窗口大小,数值越大支持的上下文越长"
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
        label="自动压缩对话"
        path="chat.compaction.enabled"
        description="上下文超长时自动压缩历史消息"
      >
        <ToggleSwitch
          checked={settings.chat.compaction.enabled}
          onChange={(v) => onSave('chat.compaction.enabled', v)}
          label="自动压缩对话"
        />
      </SettingRow>

      <SettingRow
        label="压缩保留 Token"
        path="chat.compaction.reserveTokens"
        description="压缩后保留的最小上下文 token 数"
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
        label="保留最近 Token"
        path="chat.compaction.keepRecentTokens"
        description="压缩时强制保留的最近消息 token 数"
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
        label="引导模式"
        path="chat.steeringMode"
        description="Agent 接受用户中途引导(steering)的方式"
      >
        <select
          value={settings.chat.steeringMode}
          onChange={(e) => onSave('chat.steeringMode', e.target.value)}
          className={INPUT_SM}
        >
          <option value="all">全部</option>
          <option value="one-at-a-time">一次一个</option>
        </select>
      </SettingRow>

      <SettingRow
        label="追问模式"
        path="chat.followUpMode"
        description="Agent 回答后追问用户的方式"
      >
        <select
          value={settings.chat.followUpMode}
          onChange={(e) => onSave('chat.followUpMode', e.target.value)}
          className={INPUT_SM}
        >
          <option value="all">全部</option>
          <option value="one-at-a-time">一次一个</option>
        </select>
      </SettingRow>

      <SettingRow label="显示图片" path="chat.showImages" description="在对话中渲染 Markdown 图片">
        <ToggleSwitch
          checked={settings.chat.showImages}
          onChange={(v) => onSave('chat.showImages', v)}
          label="显示图片"
        />
      </SettingRow>

      <SettingRow
        label="对话日志记录"
        path="chat.conversationLogging"
        description="全量记录聊天流事件到 logs/chat-YYYY-MM-DD.log,含 in/out/event 三个方向"
      >
        <ToggleSwitch
          checked={settings.chat.conversationLogging}
          onChange={(v) => onSave('chat.conversationLogging', v)}
          label="对话日志记录"
        />
      </SettingRow>
    </Section>
  )
}
