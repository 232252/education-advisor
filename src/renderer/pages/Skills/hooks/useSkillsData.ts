// =============================================================
// useSkillsData — SkillsTab 数据加载与动作 handlers
// 状态与逻辑自 tabs/SkillsTab.tsx 逐字搬移,行为不变
// =============================================================

import type { Skill } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useSkillsData() {
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

  return {
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
  }
}
