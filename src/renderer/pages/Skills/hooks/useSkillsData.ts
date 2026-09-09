// =============================================================
// useSkillsData — SkillsTab 数据加载与动作 handlers
// 状态与逻辑自 tabs/SkillsTab.tsx 逐字搬移,行为不变
// =============================================================

import type { Skill } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmAction } from '../../../hooks/useConfirmAction'
import { useCtxMenuAction } from '../../../hooks/useCtxMenuAction'
import { useIpcQuery } from '../../../hooks/useIpcQuery'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { runIpcMutation } from '../../../lib/mutation'
import { toast } from '../../../stores/toastStore'

// 稳定空数组引用,避免加载前每次渲染产生新引用
const EMPTY_SKILLS: Skill[] = []

export function useSkillsData() {
  // 单源加载收口至 useIpcQuery(loading 仅首载置位,失败 toast,旧数据保留)
  const {
    data: skillsData,
    loading,
    reload: loadSkills,
  } = useIpcQuery<Skill[]>(() => getAPI().skill.list(), { loadingMode: 'initial', scope: 'Skills' })
  const skills = skillsData ?? EMPTY_SKILLS
  const { t } = useT()
  const [selected, setSelected] = useState<Skill | null>(null)
  const [editContent, setEditContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 自定义确认对话框状态(状态机统一走 useConfirmAction)
  const { state: confirmState, setState: setConfirmState, ask } = useConfirmAction()

  // P2 优化: 预计算右键菜单 JSON,避免列表每行每次渲染都 JSON.stringify
  const userMenuJson = useMemo(
    () =>
      JSON.stringify([{ label: t('common.delete'), action: 'delete', variant: 'danger' as const }]),
    [t],
  )

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

  // 右键菜单事件处理: 技能删除(监听收口至 useCtxMenuAction,见 handleDelete 声明后)

  const handleSelect = (skill: Skill) => {
    if (dirty) {
      ask(t('page.skills.switchConfirm'), () => {
        setSelected(skill)
        setEditContent(skill.content)
        setDirty(false)
        setEditingName(false)
        setConfirmState((s) => ({ ...s, open: false }))
      })
      return
    }
    setSelected(skill)
    setEditContent(skill.content)
    setDirty(false)
    setEditingName(false)
  }

  const handleSave = () => {
    if (!selected || !dirty) return
    return runIpcMutation(() => getAPI().skill.save(selected.name, editContent), {
      // 原行为: 信封失败恒显固定文案(不透出 result.error)
      failMsg: () => t('status.failed'),
      onOk: () => {
        setDirty(false)
        setSelected({ ...selected, content: editContent })
        toast.success(t('status.success'))
      },
      catchMsg: t('error.unknown'),
      catchLog: '[Skills] Save failed:',
      setBusy: setSaving,
    }).then(() => loadSkills())
  }

  // R1-8 / UI-2 修复: 删除"当前选中且有未保存编辑"的技能时,提示未保存内容会丢失。
  const handleDelete = async (name: string) => {
    const isCurrentDirty = dirty && selected?.name === name
    ask(
      isCurrentDirty
        ? tr('page.skills.deleteConfirmDirty', { name: name })
        : tr('page.skills.deleteConfirm', { name: name }),
      async () => {
        setConfirmState((s) => ({ ...s, open: false }))
        await runIpcMutation(() => getAPI().skill.delete(name), {
          failMsg: t('toast.common.deleteFailed'),
          onOk: () => {
            toast.success(tr('page.skills.deleted', { name: name }))
            if (selected?.name === name) {
              setSelected(null)
              setDirty(false)
            }
            loadSkills()
          },
          catchMsg: t('toast.skills.deleteFailed'),
          catchLog: '[Skills] Delete failed:',
        })
      },
      { variant: 'danger' },
    )
  }
  // 右键菜单事件处理: 技能删除。
  // P1 修复(2026-08-28): 旧空依赖 effect 捕获首次渲染的 handleDelete(selected===null),
  // 删除选中技能后编辑器面板不清空 — useCtxMenuAction 的渲染期 ref 同步根除该问题
  useCtxMenuAction('data-ctx-skill-name', (action, name) => {
    if (action === 'delete') handleDelete(name)
  })

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) {
      toast.warning(t('toast.skills.enterName'))
      return
    }
    const content =
      newContent.trim() ||
      `---\ndescription: ${
        newDesc.trim() || tr('page.skills.defaultContentDesc', { name: name })
      }\n---\n\n# ${name}\n\n${t('page.skills.defaultContentBody')}\n`
    try {
      await getAPI().skill.save(name, content)
      setShowNewForm(false)
      setNewName('')
      setNewDesc('')
      setNewContent('')
      toast.success(tr('page.skills.created', { name: name }))
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
      toast.success(tr('page.skills.imported', { name: name }))
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
