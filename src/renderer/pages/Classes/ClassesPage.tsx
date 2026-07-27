// =============================================================
// 班级管理页面 — 列表 / 新建 / 编辑 / 存档 / 恢复 / 删除
// 班级记录存于本地 SQLite，class_id 与 EAA 学生的 class_id 对齐。
// 存档：默认隐藏该班学生（在学生页），数据完整保留，可恢复。
// 删除：仅删本地记录，学生记录保留（变为未分班）。
// =============================================================

import type { ClassEntity, ClassUpsertParams, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ComboBox } from '../../components/ComboBox'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, CARD_BASE, cn, INPUT_BASE, TABLE_ROW, TABLE_STICKY_HEAD, TABLE_TD, TABLE_TH } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { ClassProfile } from './ClassProfile'
import { computeAutoClassId } from './class-id'

/** 学生数统计：class_id → 人数 */
type ClassCountMap = Record<string, number>

export function ClassesPage() {
  const { t } = useT()
  const [classes, setClasses] = useState<ClassEntity[]>([])
  const [allStudents, setAllStudents] = useState<EAAStudent[]>([])
  const [counts, setCounts] = useState<ClassCountMap>({})
  const [loading, setLoading] = useState(true)
  const [selectedClass, setSelectedClass] = useState<ClassEntity | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')

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
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    message: string
    title?: string
    onConfirm: () => void
    variant?: 'default' | 'danger'
  }>({ open: false, message: '', onConfirm: () => {} })

  const loadClasses = useCallback(async () => {
    setLoading(true)
    try {
      // 先加载班级列表 (本地 DB, 极快), 立即显示
      const clsRes = await getAPI().class.list()
      // M-8 修复: 卸载保护
      if (!mountedRef.current) return
      if (clsRes.success && clsRes.data) setClasses(clsRes.data)
      // 异步加载学生列表 (EAA spawn 较慢), 加载完后更新学生数
      // 不阻塞班级列表的显示
      getAPI()
        .eaa.listStudents()
        .then((stuRes) => {
          if (!mountedRef.current) return
          const students = stuRes.data?.students ?? []
          setAllStudents(students)
          const map: ClassCountMap = {}
          for (const s of students) {
            if (s.class_id) map[s.class_id] = (map[s.class_id] ?? 0) + 1
          }
          setCounts(map)
        })
        .catch((err) => {
          console.warn('[Classes] Failed to load students:', err)
        })
    } catch (err) {
      if (!mountedRef.current) return
      console.error('[Classes] load failed:', err)
      toast.error(t('toast.students.loadClassFailed'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  // M-8 修复: mountedRef 用于异步加载的卸载保护
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    loadClasses()
  }, [loadClasses])

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes])
  const archivedClasses = useMemo(() => classes.filter((c) => c.archived), [classes])
  const visibleClasses = showArchived ? classes : activeClasses

  // 班级详情面板的可分配班级列表 memo 化，避免每次渲染新建数组
  const assignableClasses = useMemo(
    () => classes.filter((c) => !c.archived && c.id !== selectedClass?.id),
    [classes, selectedClass?.id],
  )

  // 右键菜单模板 memo 化（避免每行每次渲染都 JSON.stringify）
  const buildClassCtxMenu = useCallback(
    (archived: boolean) =>
      JSON.stringify([
        { label: t('ctxMenu.viewDetails'), action: 'view' },
        { label: t('ctxMenu.edit'), action: 'edit' },
        archived
          ? { label: t('ctxMenu.restore'), action: 'restore' }
          : { label: t('ctxMenu.archive'), action: 'archive' },
        { label: t('ctxMenu.delete'), action: 'delete', variant: 'danger' },
      ]),
    [t],
  )

  // 组合框候选项
  // - 班级名称：预设 1班~20班，可下拉选也可自己输入
  // - 年级：从已有班级派生去重，便于复用
  const nameOptions = useMemo(() => Array.from({ length: 20 }, (_, i) => `${i + 1}班`), [])
  const gradeOptions = useMemo(
    () => Array.from(new Set(classes.map((c) => c.grade).filter((v): v is string => !!v))),
    [classes],
  )

  // 班级编号自动生成逻辑已提取到 class-id.ts（gradeToNumber/classNoFromName/computeAutoClassId）

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
      await loadClasses()
    } catch (err) {
      console.error('[Classes] save failed:', err)
      toast.error(t('toast.common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = (c: ClassEntity) => {
    setConfirmState({
      open: true,
      message: t('page.classes.archive.confirm').replace('{0}', c.name),
      onConfirm: async () => {
        try {
          const res = await getAPI().class.archive(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.classes.archiveFailed'))
            return
          }
          setActionMessageAuto(`${t('page.classes.status.archived')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] archive failed:', err)
          toast.error(t('toast.classes.archiveFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  const handleRestore = (c: ClassEntity) => {
    setConfirmState({
      open: true,
      message: t('page.classes.restore.confirm').replace('{0}', c.name),
      onConfirm: async () => {
        try {
          const res = await getAPI().class.restore(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.classes.restoreFailed'))
            return
          }
          setActionMessageAuto(`${t('page.classes.status.active')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] restore failed:', err)
          toast.error(t('toast.classes.restoreFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  const handleDelete = (c: ClassEntity) => {
    // 班级有一一对应约束: 有学生的班级不能直接删除, 避免产生未分班学生
    const studentCount = counts[c.class_id] ?? 0
    if (studentCount > 0) {
      setConfirmState({
        open: true,
        message: `班级「${c.name}」中还有 ${studentCount} 名学生。\n\n请先在班级详情页将学生转出到其他班级，再删除本班级。\n（学生必须归属于某个班级）`,
        variant: 'danger',
        onConfirm: () => {
          setConfirmState((prev) => ({ ...prev, open: false }))
        },
      })
      return
    }
    setConfirmState({
      open: true,
      message: t('page.classes.delete.confirm').replace('{0}', c.name),
      variant: 'danger',
      onConfirm: async () => {
        try {
          const res = await getAPI().class.delete(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.common.deleteFailed'))
            return
          }
          setActionMessageAuto(`${t('common.delete')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] delete failed:', err)
          toast.error(t('toast.common.deleteFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  // 右键菜单事件处理
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ action: string; target: HTMLElement }>
      const action = ce.detail?.action
      const target = ce.detail?.target
      if (!action || !target) return
      const classId = target.getAttribute('data-ctx-class-id')
      if (!classId) return
      const cls = classes.find((c) => c.id === classId)
      if (!cls) return
      if (action === 'view') setSelectedClass(cls)
      else if (action === 'edit') openEdit(cls)
      else if (action === 'archive') handleArchive(cls)
      else if (action === 'restore') handleRestore(cls)
      else if (action === 'delete') handleDelete(cls)
    }
    document.addEventListener('ctx-menu-action', handler)
    return () => document.removeEventListener('ctx-menu-action', handler)
    // biome-ignore lint/correctness/useExhaustiveDependencies: openEdit/handleDelete/handleRestore/handleArchive are stable event handlers; Tauri biome 2.5.5+ does not flag this
  }, [classes, openEdit, handleDelete, handleRestore, handleArchive])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题栏 */}
      <PageHeader
        title={t('page.classes.title')}
        subtitle={t('page.classes.subtitle')}
        actions={
          <>
            {archivedClasses.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="accent-blue-500"
                />
                {t('page.classes.showArchived')}
                <span className="text-gray-400">({archivedClasses.length})</span>
              </label>
            )}
            <button
              type="button"
              onClick={loadClasses}
              aria-label={t('common.refresh')}
              className={btnStyle('ghost')}
            >
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={openCreate}
              aria-label={t('page.classes.add')}
              className={btnStyle('primary')}
            >
              + {t('page.classes.add')}
            </button>
          </>
        }
      />

      {/* 操作反馈 */}
      {actionMessage && (
        <div className="flex-shrink-0 px-6 py-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20">
          {actionMessage}
        </div>
      )}

      {/* 内容区：左侧班级列表 + 右侧班级详情（点击行打开） */}
      <div className="flex-1 flex overflow-hidden">
        <div
          className={`overflow-auto px-6 py-4 transition-all duration-300 ${selectedClass ? 'w-[45%] border-r border-gray-200 dark:border-white/[0.06]' : 'w-full'}`}
        >
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-12">{t('common.loading')}</div>
          ) : visibleClasses.length === 0 ? (
            <EmptyState
              icon="🏫"
              title={t('page.classes.empty')}
              description="点击右上角「+」按钮创建第一个班级"
            />
          ) : (
            <table className="w-full text-sm">
              <thead className={TABLE_STICKY_HEAD}>
                <tr>
                  <th className={TABLE_TH}>{t('page.classes.col.classId')}</th>
                  <th className={TABLE_TH}>{t('page.classes.col.name')}</th>
                  <th className={TABLE_TH}>{t('page.classes.col.grade')}</th>
                  <th className={TABLE_TH}>{t('page.classes.col.teacher')}</th>
                  <th className={cn(TABLE_TH, 'text-center')}>
                    {t('page.classes.col.students')}
                  </th>
                  <th className={TABLE_TH}>{t('page.classes.col.status')}</th>
                  <th className={cn(TABLE_TH, 'text-center')}>
                    {t('page.classes.col.action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleClasses.map((c) => (
                  <tr
                    key={c.id}
                    data-ctx-menu={buildClassCtxMenu(c.archived)}
                    data-ctx-class-id={c.id}
                    onClick={() => setSelectedClass(c)}
                    className={cn(
                      TABLE_ROW,
                      'cursor-pointer',
                      c.archived && 'opacity-60',
                      selectedClass?.id === c.id && 'bg-blue-600/10 border-l-2 border-l-blue-400',
                    )}
                  >
                    <td className={cn(TABLE_TD, 'font-mono text-xs text-gray-600 dark:text-gray-300')}>
                      {c.class_id}
                    </td>
                    <td className={cn(TABLE_TD, 'font-medium')}>{c.name}</td>
                    <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
                      {c.grade || t('common.dash')}
                    </td>
                    <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>
                      {c.teacher || t('common.dash')}
                    </td>
                    <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
                      {counts[c.class_id] ?? 0}
                    </td>
                    <td className={TABLE_TD}>
                      {c.archived ? (
                        <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                          {t('page.classes.status.archived')}
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 text-xs rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                          {t('page.classes.status.active')}
                        </span>
                      )}
                    </td>
                    <td className={TABLE_TD} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          aria-label={t('page.classes.edit')}
                          className={btnStyle('ghost')}
                        >
                          {t('page.classes.edit')}
                        </button>
                        {c.archived ? (
                          <button
                            type="button"
                            onClick={() => handleRestore(c)}
                            aria-label={t('page.classes.restore')}
                            className={btnStyle('ghost')}
                          >
                            {t('page.classes.restore')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleArchive(c)}
                            aria-label={t('page.classes.archive')}
                            className={btnStyle('ghost')}
                          >
                            {t('page.classes.archive')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(c)}
                          aria-label={t('page.classes.delete')}
                          className={btnStyle('ghost')}
                        >
                          {t('page.classes.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 右侧：班级详情面板 */}
        {selectedClass && (
          <div className="w-[55%] flex flex-col overflow-hidden">
            <ClassProfile
              key={selectedClass.id}
              classEntity={selectedClass}
              allStudents={allStudents}
              allClasses={assignableClasses}
              onClose={() => setSelectedClass(null)}
              onRefresh={loadClasses}
            />
          </div>
        )}
      </div>

      {/* 新建/编辑弹层：点击遮罩空白处关闭 */}
      {formOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <div className={`${CARD_BASE} animate-scale-in shadow-xl w-96 p-5`}>
            <h2 className="text-sm font-semibold mb-4">
              {editingId ? t('page.classes.edit') : t('page.classes.add')}
            </h2>
            <div className="space-y-3">
              {/* 复制已有班级为模板（仅新建模式） */}
              {!editingId && classes.length > 0 && (
                <label className="block">
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {t('page.classes.form.template')}
                  </span>
                  <select
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className={cn('w-full', INPUT_BASE)}
                  >
                    <option value="">{t('page.classes.form.template.none')}</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.class_id}>
                        {c.class_id} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.classId')}
                </span>
                <input
                  type="text"
                  value={form.class_id}
                  onChange={(e) => onClassIdChange(e.target.value)}
                  disabled={!!editingId}
                  placeholder="G7-3"
                  className={cn('w-full', INPUT_BASE, 'disabled:opacity-50 disabled:cursor-not-allowed')}
                />
                <span className="block text-xs text-gray-400 mt-0.5">
                  {autoClassId && !editingId
                    ? t('page.classes.form.classId.auto', '根据年级与班号自动生成，可手动修改')
                    : t('page.classes.form.classId.hint')}
                </span>
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.name')} *
                </span>
                <ComboBox
                  value={form.name ?? ''}
                  onChange={onNameChange}
                  options={nameOptions}
                  placeholder={t('page.classes.form.name.ph')}
                  ariaLabel={t('page.classes.form.name')}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.grade')}
                </span>
                <ComboBox
                  value={form.grade ?? ''}
                  onChange={onGradeChange}
                  options={gradeOptions}
                  placeholder={t('page.classes.form.grade.ph')}
                  ariaLabel={t('page.classes.form.grade')}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.teacher')}
                </span>
                <input
                  type="text"
                  value={form.teacher ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, teacher: e.target.value }))}
                  placeholder={t('page.classes.form.teacher.ph')}
                  className={cn('w-full', INPUT_BASE)}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.note')}
                </span>
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder={t('page.classes.form.note.ph')}
                  className={cn('w-full', INPUT_BASE)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={closeForm}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
