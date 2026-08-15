// =============================================================
// SkillEditor — 右侧技能编辑区
// 含: 编辑器头部(重命名/删除/保存) + 编辑器主体 + 底部状态栏
// 结构与逻辑自 tabs/SkillsTab.tsx 逐字搬移
// =============================================================

import type { Skill } from '@shared/types'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

interface SkillEditorProps {
  selected: Skill
  editContent: string
  setEditContent: (v: string) => void
  setDirty: (v: boolean) => void
  dirty: boolean
  saving: boolean
  editingName: boolean
  setEditingName: (v: boolean) => void
  editNameValue: string
  setEditNameValue: (v: string) => void
  setSelected: (s: Skill) => void
  onSave: () => void
  onDelete: (name: string) => void
  /** 重命名成功后刷新列表(原 loadSkills) */
  reloadSkills: () => void
}

export function SkillEditor({
  selected,
  editContent,
  setEditContent,
  setDirty,
  dirty,
  saving,
  editingName,
  setEditingName,
  editNameValue,
  setEditNameValue,
  setSelected,
  onSave,
  onDelete,
  reloadSkills,
}: SkillEditorProps) {
  const { t } = useT()
  return (
    <>
      {/* 编辑器头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50/50 dark:bg-surface-tertiary/50">
        <div className="flex items-center gap-3 min-w-0">
          {editingName && selected.source === 'user' ? (
            <input
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const newName = editNameValue.trim()
                  if (newName && newName !== selected.name) {
                    // H-5 修复: 重命名流程加 try/catch,避免半成功状态(save 成功但 delete 失败)
                    try {
                      // Rename: create new, copy content, delete old
                      await getAPI().skill.save(newName, editContent)
                      await getAPI().skill.delete(selected.name)
                      setSelected({ ...selected, name: newName })
                      toast.success(t('toast.skills.renamed'))
                      reloadSkills()
                    } catch (err) {
                      console.error('[Skills] Rename failed:', err)
                      toast.error(t('toast.skills.renameFailed'))
                    }
                  }
                  setEditingName(false)
                }
                if (e.key === 'Escape') setEditingName(false)
              }}
              className={cn(
                INPUT_BASE,
                'text-lg font-semibold px-2 py-0.5 min-w-[120px] border-blue-300 dark:border-blue-500',
              )}
            />
          ) : (
            <button
              type="button"
              className="text-lg font-semibold truncate hover:text-blue-500 transition-colors bg-transparent text-left"
              disabled={selected.source !== 'user'}
              onClick={() => {
                if (selected.source === 'user') {
                  setEditNameValue(selected.name)
                  setEditingName(true)
                }
              }}
              title={
                selected.source === 'user'
                  ? t('page.skills.renameHint')
                  : t('page.skills.projectReadonly')
              }
            >
              {selected.name}
            </button>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full
            ${
              selected.source === 'user'
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
            }`}
          >
            {selected.source === 'user'
              ? t('page.skills.userSkill')
              : t('page.skills.projectSkill')}
          </span>
          {dirty && (
            <span className="text-[10px] text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
              {t('page.skills.unsaved')}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selected.source === 'user' && (
            <button
              type="button"
              onClick={() => onDelete(selected.name)}
              className={cn(
                btnStyle('secondary'),
                'text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-300 dark:hover:bg-red-900/30 dark:hover:text-red-400 dark:hover:border-red-700',
              )}
            >
              {t('page.skills.deleteWithIcon')}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving || selected.source !== 'user'}
            className={cn(
              btnStyle(dirty && selected.source === 'user' ? 'primary' : 'secondary'),
              'text-xs',
            )}
          >
            {saving
              ? t('page.skills.saving')
              : dirty
                ? t('page.skills.saveBtn')
                : t('page.skills.saved')}
          </button>
        </div>
      </div>

      {/* 编辑器 */}
      <textarea
        value={editContent}
        onChange={(e) => {
          setEditContent(e.target.value)
          setDirty(true)
        }}
        className="flex-1 bg-white text-gray-700 dark:bg-surface-primary dark:text-gray-300 p-5 text-sm font-mono resize-none
          focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 leading-relaxed"
        spellCheck={false}
        placeholder={t('page.skills.editorPlaceholder')}
        disabled={selected.source !== 'user'}
      />

      {/* 底部状态栏 */}
      <div className="px-4 py-1.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-600 flex items-center justify-between bg-gray-50/50 dark:bg-surface-tertiary/50">
        <span>
          {t('page.skills.statusLines')
            .replace('{lines}', String(editContent.split('\n').length))
            .replace('{chars}', String(editContent.length))}
        </span>
        <span>
          {selected.source === 'user' ? t('page.skills.editable') : t('page.skills.readonly')}
        </span>
      </div>
    </>
  )
}
