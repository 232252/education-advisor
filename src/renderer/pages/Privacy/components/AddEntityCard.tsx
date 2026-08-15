// =============================================================
// AddEntityCard — 添加隐私实体卡(类型选择 + 名称输入)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
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
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">添加实体</h2>
        <button
          type="button"
          onClick={onToggleForm}
          aria-label={showAddForm ? '取消添加实体' : '添加实体'}
          className={btnStyle('primary')}
        >
          {showAddForm ? '取消' : '+ 添加实体'}
        </button>
      </div>
      {showAddForm && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-52">
            <label
              htmlFor="new-entity-type"
              className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
            >
              实体类型
            </label>
            <select
              id="new-entity-type"
              value={newEntityType}
              onChange={(e) => setNewEntityType(e.target.value)}
              className={cn('w-full', INPUT_BASE)}
            >
              <option value="person">人物 (学生/教师/家长)</option>
              <option value="student_id">学号</option>
              <option value="id_card">身份证号</option>
              <option value="phone">电话</option>
              <option value="email">邮箱</option>
              <option value="place">地点</option>
              <option value="org">组织 (学校/班级)</option>
            </select>
          </div>
          <div className="flex-1">
            <label
              htmlFor="new-entity-name"
              className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
            >
              实体名称 (必填)
            </label>
            <input
              id="new-entity-name"
              type="text"
              value={newEntityName}
              onChange={(e) => setNewEntityName(e.target.value)}
              placeholder="输入实体名称 (如:张三)..."
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
            aria-label="确认添加实体"
            className={btnStyle('primary')}
          >
            {adding ? '添加中...' : '确认添加'}
          </button>
        </div>
      )}
    </Card>
  )
}
