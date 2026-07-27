// =============================================================
// 技能工作台 — Skill 管理与编辑
// =============================================================

import type { Skill } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, CARD_BASE, cn, INPUT_BASE, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

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
const EMPTY_MENU_JSON = '[]'

export function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([])
  const { t } = useT()
  const [selected, setSelected] = useState<Skill | null>(null)
  const [editContent, setEditContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 自定义确认对话框状态
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    message: string
    onConfirm: () => void
    variant?: 'default' | 'danger'
  }>({ open: false, message: '', onConfirm: () => {} })

  // P2 优化: 预计算右键菜单 JSON,避免列表每行每次渲染都 JSON.stringify
  const userMenuJson = useMemo(
    () =>
      JSON.stringify([{ label: t('common.delete'), action: 'delete', variant: 'danger' as const }]),
    [t],
  )

  const loadSkills = useCallback(async () => {
    try {
      const data = await getAPI().skill.list()
      setSkills(data)
    } catch (err) {
      console.error('[Skills] Failed to load:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // R1-8 / UI-3 修复: 有未保存编辑时,关闭窗口/刷新页面前提示,防止静默丢数据。
  // beforeunload 在 Tauri WebView 里同样生效(主窗口关闭触发)。
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 现代浏览器忽略自定义文案,但 returnValue 非空即触发原生提示
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // 右键菜单事件处理: 技能删除
  // P1 修复: 用 ref 持有最新的 handleDelete,避免空依赖 useEffect 闭包过期
  // (旧代码捕获首次渲染的 handleDelete,其中 selected===null,导致删除选中技能后编辑器面板不清空)
  const handleDeleteRef = useRef<(name: string) => void>(() => {})
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ action: string; target: HTMLElement }>
      const action = ce.detail?.action
      const target = ce.detail?.target
      if (!action || !target) return
      const name = target.getAttribute('data-ctx-skill-name')
      if (!name) return
      if (action === 'delete') handleDeleteRef.current(name)
    }
    document.addEventListener('ctx-menu-action', handler)
    return () => document.removeEventListener('ctx-menu-action', handler)
  }, [])

  const handleSelect = (skill: Skill) => {
    if (dirty) {
      setConfirmState({
        open: true,
        message: t('page.skills.switchConfirm'),
        onConfirm: () => {
          setSelected(skill)
          setEditContent(skill.content)
          setDirty(false)
          setEditingName(false)
          setConfirmState((s) => ({ ...s, open: false }))
        },
      })
      return
    }
    setSelected(skill)
    setEditContent(skill.content)
    setDirty(false)
    setEditingName(false)
  }

  const handleSave = async () => {
    if (!selected || !dirty) return
    setSaving(true)
    try {
      const result = await getAPI().skill.save(selected.name, editContent)
      if (result.success) {
        setDirty(false)
        setSelected({ ...selected, content: editContent })
        toast.success(t('status.success'))
      } else {
        toast.error(t('status.failed'))
      }
    } catch (err) {
      console.error('[Skills] Save failed:', err)
      toast.error(t('error.unknown'))
    } finally {
      setSaving(false)
    }
    loadSkills()
  }

  // R1-8 / UI-2 修复: 删除"当前选中且有未保存编辑"的技能时,提示未保存内容会丢失。
  const handleDelete = async (name: string) => {
    const isCurrentDirty = dirty && selected?.name === name
    setConfirmState({
      open: true,
      message: isCurrentDirty
        ? t('page.skills.deleteConfirmDirty').replace('{name}', name)
        : t('page.skills.deleteConfirm').replace('{name}', name),
      variant: 'danger',
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }))
        try {
          const result = await getAPI().skill.delete(name)
          if (!result.success) {
            toast.error(result.error || t('toast.common.deleteFailed'))
            return
          }
          toast.success(t('page.skills.deleted').replace('{name}', name))
          if (selected?.name === name) {
            setSelected(null)
            setDirty(false)
          }
          loadSkills()
        } catch (err) {
          console.error('[Skills] Delete failed:', err)
          toast.error(t('toast.skills.deleteFailed'))
        }
      },
    })
  }
  // P1 修复: 在 handleDelete 声明后同步到 ref,供 useEffect 中的事件监听器使用
  handleDeleteRef.current = handleDelete

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast.warning(t('toast.skills.enterName'))
      return
    }
    const content =
      newContent.trim() ||
      `---\ndescription: ${
        newDesc.trim() || t('page.skills.defaultContentDesc').replace('{name}', name)
      }\n---\n\n# ${name}\n\n${t('page.skills.defaultContentBody')}\n`
    try {
      await getAPI().skill.save(name, content)
      setShowNewForm(false)
      setNewName('')
      setNewDesc('')
      setNewContent('')
      toast.success(t('page.skills.created').replace('{name}', name))
      await loadSkills()
      const created = await getAPI().skill.get(name)
      if (created) {
        setSelected(created)
        setEditContent(created.content)
        setDirty(false)
      }
    } catch (_err) {
      toast.error(t('toast.skills.createFailed'))
    }
  }

  const handleImport = async () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      // 从文件名提取技能名称
      const name = file.name.replace(/.md$/i, '')
      // 尝试从 frontmatter 提取描述（暂不持久化，前端不展示）
      await getAPI().skill.save(name, text)
      toast.success(t('page.skills.imported').replace('{name}', name))
      await loadSkills()
    } catch (_err) {
      toast.error(t('toast.skills.importFailed'))
    }
    // 重置 input
    e.target.value = ''
  }

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
      <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] flex flex-col bg-gray-50/30 dark:bg-[#1a1e28]/30">
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
                🔄
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title={t('page.skills.importHint')}
              >
                📥
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
            <div className={cn(CARD_BASE, 'space-y-2 p-3')}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
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
                onClick={handleCreate}
                disabled={!newName.trim()}
                className={cn(btnStyle('primary'), 'w-full text-xs')}
              >
                {t('page.skills.createBtn')}
              </button>
            </div>
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
              icon="📝"
              title={t('page.skills.emptyList')}
              description={t('page.skills.emptyListHint')}
              className="py-8"
            />
          ) : (
            skills.map((s) => (
              <div
                key={s.filePath ?? `${s.source}-${s.name}`}
                data-ctx-menu={s.source === 'user' ? userMenuJson : EMPTY_MENU_JSON}
                data-ctx-skill-name={s.name}
                data-ctx-skill-source={s.source}
                className={`group relative rounded-xl transition-all duration-150 cursor-pointer border ${
                  selected?.name === s.name
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300/50 dark:border-blue-500/30 shadow-sm'
                    : 'hover:bg-gray-100 dark:hover:bg-white/[0.04] border-transparent hover:border-gray-200 dark:hover:border-white/[0.1]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(s)}
                  className="w-full text-left px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs ${
                        s.source === 'user' ? 'text-blue-500' : 'text-gray-400'
                      }`}
                    >
                      {s.source === 'user' ? '📝' : '📦'}
                    </span>
                    <span className="font-medium text-sm truncate dark:text-gray-200">
                      {s.name}
                    </span>
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
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {s.source === 'user'
                        ? t('page.skills.badge.user')
                        : t('page.skills.badge.project')}
                    </span>
                  </div>
                </button>

                {/* 删除按钮（仅用户级技能） */}
                {s.source === 'user' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(s.name)
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
            ))
          )}
        </div>
      </div>

      {/* 右侧编辑区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            {/* 编辑器头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50/50 dark:bg-[#1a1e28]/50">
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
                            loadSkills()
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
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
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
                    onClick={() => handleDelete(selected.name)}
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
                  onClick={handleSave}
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
              className="flex-1 bg-white text-gray-700 dark:bg-[#0f1117] dark:text-gray-300 p-5 text-sm font-mono resize-none
                focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 leading-relaxed"
              spellCheck={false}
              placeholder={t('page.skills.editorPlaceholder')}
              disabled={selected.source !== 'user'}
            />

            {/* 底部状态栏 */}
            <div className="px-4 py-1.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-600 flex items-center justify-between bg-gray-50/50 dark:bg-[#1a1e28]/50">
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
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon="📝"
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
