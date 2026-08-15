// =============================================================
// NewSkillForm — 新建技能内联表单(名称/描述/初始内容)
// 结构自 tabs/SkillsTab.tsx 逐字搬移
// =============================================================

import { useT } from '../../../i18n'
import { btnStyle, CARD_BASE, cn, INPUT_SM } from '../../../lib/ui-utils'

interface NewSkillFormProps {
  newName: string
  setNewName: (v: string) => void
  newDesc: string
  setNewDesc: (v: string) => void
  newContent: string
  setNewContent: (v: string) => void
  onCreate: () => void
}

export function NewSkillForm({
  newName,
  setNewName,
  newDesc,
  setNewDesc,
  newContent,
  setNewContent,
  onCreate,
}: NewSkillFormProps) {
  const { t } = useT()
  return (
    <div className={cn(CARD_BASE, 'space-y-2 p-3')}>
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCreate()
        }}
        placeholder={t('page.skills.namePlaceholder')}
        className={cn(INPUT_SM, 'w-full')}
      />
      <input
        value={newDesc}
        onChange={(e) => setNewDesc(e.target.value)}
        placeholder={t('page.skills.descPlaceholder')}
        className={cn(INPUT_SM, 'w-full')}
      />
      <textarea
        value={newContent}
        onChange={(e) => setNewContent(e.target.value)}
        placeholder={t('page.skills.contentPlaceholder')}
        rows={4}
        className={cn(INPUT_SM, 'w-full font-mono resize-none')}
      />
      <button
        type="button"
        onClick={onCreate}
        disabled={!newName.trim()}
        className={cn(btnStyle('primary'), 'w-full text-xs')}
      >
        {t('page.skills.createBtn')}
      </button>
    </div>
  )
}
