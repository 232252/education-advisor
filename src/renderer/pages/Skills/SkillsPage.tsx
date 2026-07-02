// =============================================================
// 技能工作台 — Skill 管理与编辑
// =============================================================

import type { Skill } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

export function SkillsPage() {
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

  const handleSelect = (skill: Skill) => {
    if (dirty) {
      setConfirmState({
        open: true,
        message: '有未保存的更改，确定要切换吗？',
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

  const handleDelete = async (name: string) => {
    setConfirmState({
      open: true,
      message: `确定要删除技能"${name}" 吗？此操作不可恢复。`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }))
        try {
          const result = await getAPI().skill.delete(name)
          if (!result.success) {
            toast.error(result.error || '删除失败')
            return
          }
          toast.success(`已删除 "${name}"`)
          if (selected?.name === name) {
            setSelected(null)
            setDirty(false)
          }
          loadSkills()
        } catch (err) {
          console.error('[Skills] Delete failed:', err)
          toast.error('删除技能失败')
        }
      },
    })
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast.warning('请输入技能名称')
      return
    }
    const content =
      newContent.trim() ||
      `---\ndescription: ${newDesc.trim() || `${name} 技能`}\n---\n\n# ${name}\n\n在此编写技能内容...\n`
    try {
      await getAPI().skill.save(name, content)
      setShowNewForm(false)
      setNewName('')
      setNewDesc('')
      setNewContent('')
      toast.success(`技能 "${name}" 创建成功`)
      await loadSkills()
      const created = await getAPI().skill.get(name)
      if (created) {
        setSelected(created)
        setEditContent(created.content)
        setDirty(false)
      }
    } catch (_err) {
      toast.error('创建技能失败')
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
      toast.success(`已导入技能 "${name}"`)
      await loadSkills()
    } catch (_err) {
      toast.error('导入技能失败')
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
    <section className="h-full flex" aria-label="技能列表" onKeyDown={handleKeyDown}>
      <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>{t('page.skills.title')}</h1>
      {/* 左侧技能列表 */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50/30 dark:bg-gray-800/30">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-200">技能列表</h2>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={loadSkills}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title="刷新"
              >
                🔄
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors"
                title="从 .md 文件导入"
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
            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              showNewForm
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
            }`}
          >
            {showNewForm ? '取消' : '+ 新建技能'}
          </button>

          {/* 新建技能表单 */}
          {showNewForm && (
            <div className="space-y-2 bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
                placeholder="技能名称（必填）"
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="技能描述（可选）"
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="技能内容（可选，支持 Markdown）"
                rows={4}
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500 resize-none"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded text-xs transition-colors"
              >
                创建技能
              </button>
            </div>
          )}
        </div>

        {/* 技能列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
              <div className="animate-pulse">加载中...</div>
            </div>
          ) : skills.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-8">
              <div className="text-3xl mb-2">📝</div>
              暂无技能
              <br />
              <span className="text-gray-400 dark:text-gray-600">点击"新建技能"创建第一个</span>
            </div>
          ) : (
            skills.map((s) => (
              <div
                key={`${s.source}-${s.name}`}
                className={`group relative rounded-xl transition-all cursor-pointer border ${
                  selected?.name === s.name
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300/50 dark:border-blue-500/30 shadow-sm'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border-transparent hover:border-gray-200 dark:hover:border-gray-600'
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
                    {s.description || '暂无描述'}
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
                      {s.source === 'user' ? '用户' : '项目'}
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
                    title="删除技能"
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
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
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
                            toast.success('已重命名')
                            loadSkills()
                          } catch (err) {
                            console.error('[Skills] Rename failed:', err)
                            toast.error('重命名失败,请检查新名称是否已存在')
                          }
                        }
                        setEditingName(false)
                      }
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    className="text-lg font-semibold bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-500 rounded px-2 py-0.5 min-w-[120px] focus:outline-none"
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
                    title={selected.source === 'user' ? '点击重命名' : '项目技能不可重命名'}
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
                  {selected.source === 'user' ? '用户技能' : '项目技能'}
                </span>
                {dirty && (
                  <span className="text-[10px] text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
                    未保存
                  </span>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {selected.source === 'user' && (
                  <button
                    type="button"
                    onClick={() => handleDelete(selected.name)}
                    className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-300 dark:hover:bg-red-900/30 dark:hover:text-red-400 dark:hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    🗑 删除
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saving || selected.source !== 'user'}
                  className={`text-xs px-4 py-1.5 rounded-lg transition-colors shadow-sm ${
                    dirty && selected.source === 'user'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {saving ? '保存中...' : dirty ? '💾 保存 (Ctrl+S)' : '已保存'}
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
              className="flex-1 bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300 p-5 text-sm font-mono resize-none
                focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 leading-relaxed"
              spellCheck={false}
              placeholder="在此编辑技能内容..."
              disabled={selected.source !== 'user'}
            />

            {/* 底部状态栏 */}
            <div className="px-4 py-1.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-600 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
              <span>
                {editContent.split('\n').length} 行 · {editContent.length} 字符
              </span>
              <span>{selected.source === 'user' ? '可编辑' : '只读'}</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400 dark:text-gray-500">
              <div className="text-5xl mb-4">📝</div>
              <div className="text-sm">选择左侧技能开始编辑</div>
              <div className="text-xs mt-2 text-gray-400 dark:text-gray-600">
                或点击 "+ 新建技能" 创建新技能
              </div>
            </div>
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
