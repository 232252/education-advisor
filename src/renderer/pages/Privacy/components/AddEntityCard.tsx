// =============================================================
// AddEntityCard — 添加隐私实体卡(类型选择 + 名称输入)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { useT } from '../../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface AddEntityCardProps {
  showAddForm: boolean
  onToggleForm: () => void
  newEntityType: string
  setNewEntityType: (v: string) => void
  newEntityName: string
  setNewEntityName: (v: string) => void
  adding: boolean
  onAddEntity: () => void
}

export function AddEntityCard({
  showAddForm,
  onToggleForm,
  newEntityType,
  setNewEntityType,
  newEntityName,
  setNewEntityName,
  adding,
  onAddEntity,
}: AddEntityCardProps) {
  const { t } = useT()
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{t('page.privacy.addEntity.title')}</h2>
        <button
          type="button"
          onClick={onToggleForm}
          aria-label={t('page.privacy.addEntity.ariaToggle')}
          className={btnStyle('primary')}
        >
          {showAddForm
            ? t('page.privacy.addEntity.cancel')
            : `+ ${t('page.privacy.addEntity.toggleOn')}`}
        </button>
      </div>
      {showAddForm && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-52">
            <label
              htmlFor="new-entity-type"
              className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
            >
              {t('page.privacy.addEntity.type')}
            </label>
            <select
              id="new-entity-type"
              value={newEntityType}
              onChange={(e) => setNewEntityType(e.target.value)}
              className={cn('w-full', INPUT_BASE)}
            >
              <option value="person">{t('page.privacy.addEntity.type.person')}</option>
              <option value="student_id">{t('page.privacy.addEntity.type.studentId')}</option>
              <option value="id_card">{t('page.privacy.addEntity.type.idCard')}</option>
              <option value="phone">{t('page.privacy.addEntity.type.phone')}</option>
              <option value="email">{t('page.privacy.addEntity.type.email')}</option>
              <option value="place">{t('page.privacy.addEntity.type.place')}</option>
              <option value="org">{t('page.privacy.addEntity.type.org')}</option>
            </select>
          </div>
          <div className="flex-1">
            <label
              htmlFor="new-entity-name"
              className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
            >
              {t('page.privacy.addEntity.name')}
            </label>
            <input
              id="new-entity-name"
              type="text"
              value={newEntityName}
              onChange={(e) => setNewEntityName(e.target.value)}
              placeholder={t('page.privacy.addEntity.namePlaceholder')}
              className={cn('w-full', INPUT_BASE)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !adding) onAddEntity()
              }}
            />
          </div>
          <button
            type="button"
            onClick={onAddEntity}
            disabled={adding || !newEntityName.trim()}
            aria-label={t('page.privacy.addEntity.ariaConfirm')}
            className={btnStyle('primary')}
          >
            {adding ? t('page.privacy.addEntity.adding') : t('page.privacy.addEntity.confirm')}
          </button>
        </div>
      )}
    </Card>
  )
}
