// =============================================================
// 班级管理页面 — 列表 / 新建 / 编辑 / 存档 / 恢复 / 删除
// 班级记录存于本地 SQLite，class_id 与 EAA 学生的 class_id 对齐。
// 存档：默认隐藏该班学生（在学生页），数据完整保留，可恢复。
// 删除：仅删本地记录，学生记录保留（变为未分班）。
// 编排层：组合数据 hook / 表单 hook / 操作 hook 与表格/弹层组件。
// =============================================================

import type { ClassEntity } from '@shared/types'
import { School } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { btnStyle } from '../../lib/ui-utils'
import { ClassProfile } from './ClassProfile'
import { ClassFormDialog } from './components/ClassFormDialog'
import { ClassTable } from './components/ClassTable'
import { useClassActions } from './hooks/useClassActions'
import { useClassesData } from './hooks/useClassesData'
import { useClassForm } from './hooks/useClassForm'

export function ClassesPage() {
  const { t } = useT()
  const { classes, allStudents, counts, loading, loadClasses } = useClassesData()
  const [selectedClass, setSelectedClass] = useState<ClassEntity | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  // 全局搜索(Ctrl+K)跳转: 班级列表加载完成后按 class_id 自动打开详情
  useEffect(() => {
    const targetId = searchParams.get('class_id')
    if (!targetId || loading) return
    if (classes.length === 0) {
      setSearchParams({}, { replace: true })
      return
    }
    const match = classes.find((c) => c.class_id === targetId || c.id === targetId)
    setSearchParams({}, { replace: true })
    if (match) setSelectedClass(match)
  }, [classes, loading, searchParams, setSearchParams])

  const {
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
  } = useClassForm(classes, loadClasses)

  const {
    actionMessage,
    confirmState,
    setConfirmState,
    handleArchive,
    handleRestore,
    handleDelete,
  } = useClassActions(counts, loadClasses)

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
              icon={<School className="h-6 w-6" />}
              title={t('page.classes.empty')}
              description="点击右上角「+」按钮创建第一个班级"
            />
          ) : (
            <ClassTable
              classes={visibleClasses}
              counts={counts}
              selectedClassId={selectedClass?.id}
              buildCtxMenu={buildClassCtxMenu}
              onSelect={setSelectedClass}
              onEdit={openEdit}
              onArchive={handleArchive}
              onRestore={handleRestore}
              onDelete={handleDelete}
            />
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
        <ClassFormDialog
          classes={classes}
          editingId={editingId}
          form={form}
          saving={saving}
          templateId={templateId}
          autoClassId={autoClassId}
          nameOptions={nameOptions}
          gradeOptions={gradeOptions}
          onClose={closeForm}
          onApplyTemplate={applyTemplate}
          onClassIdChange={onClassIdChange}
          onNameChange={onNameChange}
          onGradeChange={onGradeChange}
          onTeacherChange={(v) => setForm((f) => ({ ...f, teacher: v }))}
          onNoteChange={(v) => setForm((f) => ({ ...f, note: v }))}
          onSave={handleSave}
        />
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
