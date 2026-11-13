// =============================================================
// 斜杠指令菜单 — 输入 / 时弹出 DSH 内置指令，点选填入输入框。
// 目录来自 @shared/slash-commands（与主进程门面识别同一份）。
// 执行仍由主进程经 DSH session/query 路由，本组件只负责发现与填入。
// =============================================================

import { matchSlashCommands } from '@shared/slash-commands'
import { useT } from '../../../i18n'

interface SlashCommandMenuProps {
  input: string
  onSelect: (commandLine: string) => void
}

export function SlashCommandMenu({ input, onSelect }: SlashCommandMenuProps) {
  const { t } = useT()
  const trimmed = input.trim()
  // 只在「以 / 开头、且尚未输入参数」时弹菜单（一旦有空格说明在写参数）
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return null
  const matches = matchSlashCommands(trimmed)
  if (matches.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-surface-elevated shadow-lg z-20"
      role="listbox"
      aria-label={t('page.chat.slash.aria', '斜杠指令')}
    >
      {matches.map((c) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected="false"
          onClick={() => onSelect(`/${c.name} `)}
          className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-baseline gap-2 border-b border-gray-100 dark:border-white/[0.04] last:border-b-0"
        >
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400 flex-shrink-0">
            /{c.name}
          </span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{c.zh}</span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
            {c.description}
          </span>
        </button>
      ))}
    </div>
  )
}
