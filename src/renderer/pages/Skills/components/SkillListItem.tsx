// =============================================================
// SkillListItem — 技能列表单行(图标/徽章/右键菜单数据/删除按钮)
// 结构自 tabs/SkillsTab.tsx 逐字搬移
// =============================================================

import type { Skill } from '@shared/types'
import { FileText, Package } from 'lucide-react'
import { useT } from '../../../i18n'

const EMPTY_MENU_JSON = '[]'

interface SkillListItemProps {
  skill: Skill
  /** 是否为当前选中技能(原判断 selected?.name === s.name) */
  isSelected: boolean
  /** 用户级技能右键菜单 JSON(hook 预计算) */
  userMenuJson: string
  onSelect: (skill: Skill) => void
  onDelete: (name: string) => void
}

export function SkillListItem({
  skill: s,
  isSelected,
  userMenuJson,
  onSelect,
  onDelete,
}: SkillListItemProps) {
  const { t } = useT()
  return (
    <div
      data-ctx-menu={s.source === 'user' ? userMenuJson : EMPTY_MENU_JSON}
      data-ctx-skill-name={s.name}
      data-ctx-skill-source={s.source}
      className={`group relative rounded-xl transition-all duration-150 cursor-pointer border ${
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300/50 dark:border-blue-500/30 shadow-sm'
          : 'hover:bg-gray-100 dark:hover:bg-white/[0.04] border-transparent hover:border-gray-200 dark:hover:border-white/[0.1]'
      }`}
    >
      <button type="button" onClick={() => onSelect(s)} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${s.source === 'user' ? 'text-blue-500' : 'text-gray-400'}`}>
            {s.source === 'user' ? (
              <FileText className="h-3.5 w-3.5" />
            ) : (
              <Package className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="font-medium text-sm truncate dark:text-gray-200">{s.name}</span>
        </div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-1 ml-6">
          {s.description || t('page.skills.noDesc')}
        </div>
        <div className="flex items-center gap-2 mt-1.5 ml-6">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full
            ${
              s.source === 'user'
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
            }`}
          >
            {s.source === 'user' ? t('page.skills.badge.user') : t('page.skills.badge.project')}
          </span>
        </div>
      </button>

      {/* 删除按钮（仅用户级技能） */}
      {s.source === 'user' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(s.name)
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100
            text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-all text-xs
            w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-900/20"
          title={t('page.skills.deleteBtn')}
        >
          ×
        </button>
      )}
    </div>
  )
}
