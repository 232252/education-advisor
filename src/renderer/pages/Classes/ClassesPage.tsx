// =============================================================
// 班级管理页面 — 列表 / 新建 / 编辑 / 存档 / 恢复 / 删除
// 班级记录存于本地 SQLite，class_id 与 EAA 学生的 class_id 对齐。
// 存档：默认隐藏该班学生（在学生页），数据完整保留，可恢复。
// 删除：仅删本地记录，学生记录保留（变为未分班）。
// =============================================================

import type { ClassEntity, ClassUpsertParams, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'
import { ClassProfile } from './ClassProfile'

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
      const [clsRes, stuRes] = await Promise.all([
        getAPI().class.list(),
        getAPI().eaa.listStudents(),
      ])
      if (clsRes.success && clsRes.data) setClasses(clsRes.data)
      const students = stuRes.data?.students ?? []
      setAllStudents(students)
      // 聚合每个 class_id 的学生数
      const map: ClassCountMap = {}
      for (const s of students) {
        if (s.class_id) map[s.class_id] = (map[s.class_id] ?? 0) + 1
      }
      setCounts(map)
    } catch (err) {
      console.error('[Classes] load failed:', err)
      toast.error('加载班级列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadClasses()
  }, [loadClasses])

  const activeClasses = useMemo(() => classes.filter((c) => !c.archived), [classes])
  const archivedClasses = useMemo(() => classes.filter((c) => c.archived), [classes])
  const visibleClasses = showArchived ? classes : activeClasses

  const openCreate = () => {
    setEditingId(null)
    setForm({ class_id: '', name: '', grade: '', note: '', teacher: '' })
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
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!form.class_id.trim() || !form.name.trim()) {
      toast.error('班级编号和名称不能为空')
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
          toast.error(res.error ?? '更新失败')
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
      toast.error('保存失败')
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
            toast.error(res.error ?? '存档失败')
            return
          }
          setActionMessageAuto(`${t('page.classes.status.archived')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] archive failed:', err)
          toast.error('存档失败')
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
            toast.error(res.error ?? '恢复失败')
            return
          }
          setActionMessageAuto(`${t('page.classes.status.active')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] restore failed:', err)
          toast.error('恢复失败')
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  const handleDelete = (c: ClassEntity) => {
    setConfirmState({
      open: true,
      message: t('page.classes.delete.confirm').replace('{0}', c.name),
      variant: 'danger',
      onConfirm: async () => {
        try {
          const res = await getAPI().class.delete(c.id)
          if (!res.success) {
            toast.error(res.error ?? '删除失败')
            return
          }
          setActionMessageAuto(`${t('common.delete')}: ${c.name}`)
          await loadClasses()
        } catch (err) {
          console.error('[Classes] delete failed:', err)
          toast.error('删除失败')
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题栏 */}
      <header className="flex-shrink-0 h-14 border-b border-gray-200 dark:border-gray-700 px-6 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">{t('page.classes.title')}</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('page.classes.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
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
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            + {t('page.classes.add')}
          </button>
        </div>
      </header>

      {/* 操作反馈 */}
      {actionMessage && (
        <div className="flex-shrink-0 px-6 py-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20">
          {actionMessage}
        </div>
      )}

      {/* 内容区：左侧班级列表 + 右侧班级详情（点击行打开） */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`overflow-auto px-6 py-4 ${selectedClass ? 'w-[45%] border-r border-gray-200 dark:border-gray-700' : 'w-full'}`}>
        {loading ? (
          <div className="text-center text-sm text-gray-400 py-12">{t('common.loading')}</div>
        ) : visibleClasses.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-12">{t('page.classes.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
              <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 px-3 font-medium">{t('page.classes.col.classId')}</th>
                <th className="py-2 px-3 font-medium">{t('page.classes.col.name')}</th>
                <th className="py-2 px-3 font-medium">{t('page.classes.col.grade')}</th>
                <th className="py-2 px-3 font-medium">{t('page.classes.col.teacher')}</th>
                <th className="py-2 px-3 font-medium text-center">
                  {t('page.classes.col.students')}
                </th>
                <th className="py-2 px-3 font-medium">{t('page.classes.col.status')}</th>
                <th className="py-2 px-3 font-medium text-center">
                  {t('page.classes.col.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleClasses.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedClass(c)}
                  className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${
                    c.archived ? 'opacity-60' : ''
                  } ${selectedClass?.id === c.id ? 'bg-blue-600/10 border-l-2 border-l-blue-400' : ''}`}
                >
                  <td className="py-2.5 px-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                    {c.class_id}
                  </td>
                  <td className="py-2.5 px-3 font-medium">{c.name}</td>
                  <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400">
                    {c.grade || t('common.dash')}
                  </td>
                  <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400">
                    {c.teacher || t('common.dash')}
                  </td>
                  <td className="py-2.5 px-3 text-center text-gray-500 dark:text-gray-400">
                    {counts[c.class_id] ?? 0}
                  </td>
                  <td className="py-2.5 px-3">
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
                  <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="text-blue-500/70 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {t('page.classes.edit')}
                      </button>
                      {c.archived ? (
                        <button
                          type="button"
                          onClick={() => handleRestore(c)}
                          className="text-green-500/70 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                        >
                          {t('page.classes.restore')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchive(c)}
                          className="text-yellow-500/70 hover:text-yellow-600 dark:hover:text-yellow-400 transition-colors"
                        >
                          {t('page.classes.archive')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        className="text-red-400/70 hover:text-red-500 dark:hover:text-red-400 transition-colors"
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 p-5">
            <h2 className="text-sm font-semibold mb-4">
              {editingId ? t('page.classes.edit') : t('page.classes.add')}
            </h2>
            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.classId')}
                </span>
                <input
                  type="text"
                  value={form.class_id}
                  onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}
                  disabled={!!editingId}
                  placeholder="G7-3"
                  className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="block text-xs text-gray-400 mt-0.5">
                  {t('page.classes.form.classId.hint')}
                </span>
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.name')} *
                </span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('page.classes.form.name.ph')}
                  className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.grade')}
                </span>
                <input
                  type="text"
                  value={form.grade}
                  onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                  placeholder={t('page.classes.form.grade.ph')}
                  className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('page.classes.form.teacher')}
                </span>
                <input
                  type="text"
                  value={form.teacher}
                  onChange={(e) => setForm((f) => ({ ...f, teacher: e.target.value }))}
                  placeholder={t('page.classes.form.teacher.ph')}
                  className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  className="w-full px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
