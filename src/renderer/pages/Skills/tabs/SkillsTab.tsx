// =============================================================
// 技能工作台 — Skill 管理与编辑 (编排层)
// 数据/动作: hooks/useSkillsData.ts
// UI 块: components/SkillListItem / NewSkillForm / SkillEditor
// =============================================================

import { FileText, RefreshCw, Upload } from 'lucide-react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { btnStyle, cn } from '../../../lib/ui-utils'
import { NewSkillForm } from '../components/NewSkillForm'
import { SkillEditor } from '../components/SkillEditor'
import { SkillListItem } from '../components/SkillListItem'
import { useSkillsData } from '../hooks/useSkillsData'

// P3 优化: 模块级常量,避免每次渲染分配新对象
const SR_ONLY_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export function SkillsTab() {
  const { t } = useT()
  const {
    skills,
    loading,
    selected,
    editContent,
    setEditContent,
    dirty,
    setDirty,
    saving,
    showNewForm,
    setShowNewForm,
    newName,
    setNewName,
    newDesc,
    setNewDesc,
    newContent,
    setNewContent,
    editingName,
    setEditingName,
    editNameValue,
    setEditNameValue,
    setSelected,
    fileInputRef,
    confirmState,
    setConfirmState,
    userMenuJson,
    loadSkills,
    handleSelect,
    handleSave,
    handleDelete,
    handleCreate,
    handleImport,
    handleFileSelected,
  } = useSkillsData()

  // 键盘快捷键保存
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (dirty && selected?.source === 'user') {
        handleSave()
      }
    }
  }

  return (
    <section
      className="h-full flex"
      aria-label={t('page.skills.listTitle')}
      onKeyDown={handleKeyDown}
    >
      <h1 style={SR_ONLY_STYLE}>{t('page.skills.title')}</h1>
      {/* 左侧技能列表 */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] flex flex-col bg-gray-50/30 dark:bg-surface-tertiary/30">
        <div className="p-3 border-b border-gray-200 dark:border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-200">
              {t('page.skills.listTitle')}
            </h2>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={loadSkills}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title={t('common.refresh')}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title={t('page.skills.importHint')}
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            onChange={handleFileSelected}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => {
              setShowNewForm(!showNewForm)
              if (showNewForm) {
                setNewName('')
                setNewDesc('')
                setNewContent('')
              }
            }}
            className={cn('w-full', showNewForm ? btnStyle('secondary') : btnStyle('primary'))}
          >
            {showNewForm ? t('page.skills.cancel') : `+ ${t('page.skills.new')}`}
          </button>

          {/* 新建技能表单 */}
          {showNewForm && (
            <NewSkillForm
              newName={newName}
              setNewName={setNewName}
              newDesc={newDesc}
              setNewDesc={setNewDesc}
              newContent={newContent}
              setNewContent={setNewContent}
              onCreate={handleCreate}
            />
          )}
        </div>

        {/* 技能列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
              <div className="animate-pulse">{t('page.skills.loading')}</div>
            </div>
          ) : skills.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title={t('page.skills.emptyList')}
              description={t('page.skills.emptyListHint')}
              className="py-8"
            />
          ) : (
            skills.map((s) => (
              <SkillListItem
                key={s.filePath ?? `${s.source}-${s.name}`}
                skill={s}
                isSelected={selected?.name === s.name}
                userMenuJson={userMenuJson}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>

      {/* 右侧编辑区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <SkillEditor
            selected={selected}
            editContent={editContent}
            setEditContent={setEditContent}
            setDirty={setDirty}
            dirty={dirty}
            saving={saving}
            editingName={editingName}
            setEditingName={setEditingName}
            editNameValue={editNameValue}
            setEditNameValue={setEditNameValue}
            setSelected={setSelected}
            onSave={handleSave}
            onDelete={handleDelete}
            reloadSkills={loadSkills}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title={t('page.skills.empty')}
              description={t('page.skills.empty.hint')}
            />
          </div>
        )}
      </div>

      {/* 自定义确认对话框 */}
      <ConfirmDialog
        open={confirmState.open}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
    </section>
  )
}
