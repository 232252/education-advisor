// =============================================================
// 班级新建/编辑表单 hook — 状态 / 模板预填 / 编号自动生成 / 保存
// =============================================================

import type { ClassEntity, ClassUpsertParams } from '@shared/types'
import { useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { computeAutoClassId } from '../class-id'

/** 班级表单状态与操作（新建/编辑共用） */
export function useClassForm(classes: ClassEntity[], reload: () => Promise<void>) {
  const { t } = useT()
  // 新建/编辑表单状态
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ClassUpsertParams & { note?: string }>({
    class_id: '',
    name: '',
    grade: '',
    note: '',
    teacher: '',
  })
  const [saving, setSaving] = useState(false)
  // 复制班级模板：选中的模板班级 class_id（'' 表示不使用模板）
  const [templateId, setTemplateId] = useState('')
  // 班级编号是否走自动生成：true=跟随年级+班号自动算；用户一旦手改编号则转为 false
  const [autoClassId, setAutoClassId] = useState(true)

  const openCreate = () => {
    setEditingId(null)
    setForm({ class_id: '', name: '', grade: '', note: '', teacher: '' })
    setTemplateId('')
    setAutoClassId(true)
    setFormOpen(true)
  }

  const openEdit = (c: ClassEntity) => {
    setEditingId(c.id)
    setForm({
      class_id: c.class_id,
      name: c.name,
      grade: c.grade ?? '',
      note: c.note ?? '',
      teacher: c.teacher ?? '',
    })
    setAutoClassId(false) // 编辑时编号不可改，关闭自动生成
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setTemplateId('')
  }

  // 选择已有班级作为模板：预填 name/grade/note/teacher（class_id 需用户另起，保证唯一）
  const applyTemplate = (classId: string) => {
    setTemplateId(classId)
    if (!classId) return
    const src = classes.find((c) => c.class_id === classId)
    if (!src) return
    setForm((f) => ({
      ...f,
      name: src.name,
      grade: src.grade ?? '',
      note: src.note ?? '',
      teacher: src.teacher ?? '',
    }))
  }

  // 自动重算班级编号：年级数字-班号，如 七年级 + 3班 → G7-3
  const recomputeAutoClassId = (grade: string, name: string) => {
    const autoId = computeAutoClassId(grade, name)
    if (autoId) setForm((f) => ({ ...f, class_id: autoId }))
  }
  const onNameChange = (v: string) => {
    setForm((f) => ({ ...f, name: v }))
    if (autoClassId) recomputeAutoClassId(form.grade ?? '', v)
  }
  const onGradeChange = (v: string) => {
    setForm((f) => ({ ...f, grade: v }))
    if (autoClassId) recomputeAutoClassId(v, form.name ?? '')
  }
  // 用户手改编号：关闭自动生成，之后不再覆盖
  const onClassIdChange = (v: string) => {
    setForm((f) => ({ ...f, class_id: v }))
    setAutoClassId(false)
  }

  const handleSave = async () => {
    if (!form.class_id.trim() || !form.name.trim()) {
      toast.error(t('toast.classes.validationEmpty'))
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        // 编辑：class_id 不可改，只更新 name/grade/note/teacher
        const res = await getAPI().class.update(editingId, {
          name: form.name,
          grade: form.grade || null,
          note: form.note || null,
          teacher: form.teacher || null,
        })
        if (!res.success) {
          toast.error(res.error ?? t('toast.classes.updateFailed'))
          return
        }
        toast.success(t('common.save'))
      } else {
        const res = await getAPI().class.create({
          class_id: form.class_id,
          name: form.name,
          grade: form.grade || undefined,
          note: form.note || undefined,
          teacher: form.teacher || undefined,
        })
        if (!res.success || !res.data) {
          const msg = (res as { error?: string }).error
          toast.error(t('page.classes.create.failed').replace('{0}', msg ?? ''))
          return
        }
        toast.success(t('page.classes.create.success'))
      }
      closeForm()
      await reload()
    } catch (err) {
      console.error('[Classes] save failed:', err)
      toast.error(t('toast.common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return {
    formOpen,
    editingId,
    form,
    setForm,
    saving,
    templateId,
    autoClassId,
    openCreate,
    openEdit,
    closeForm,
    applyTemplate,
    onNameChange,
    onGradeChange,
    onClassIdChange,
    handleSave,
  }
}
