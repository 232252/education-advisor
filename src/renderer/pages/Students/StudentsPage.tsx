// =============================================================
// 学生管理页面 — 纯编排层（逻辑在 hooks/, UI 在 components/, 纯函数在 lib/）
// =============================================================
import type { EAAStudent } from '@shared/types'
import { Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { TableSkeleton } from '../../components/Skeleton'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { cn, TABLE_STICKY_HEAD, TABLE_TH } from '../../lib/ui-utils'
import {
  AddStudentForm,
  ExcelImportDialog,
  ExportMenu,
  ImportMenu,
  StudentRow,
  StudentsToolbar,
} from './components'
import { useStudentActions } from './hooks/useStudentActions'
import { useStudentList } from './hooks/useStudentList'
import { useStudentSelection } from './hooks/useStudentSelection'
import { countArchivedHidden, filterStudents, sortStudentsByRisk } from './lib/student-filters'
import { StudentProfile } from './StudentProfile'

export function StudentsPage() {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<EAAStudent | null>(null)
  const [addingStudent, setAddingStudent] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentClassId, setNewStudentClassId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')
  const [showArchivedClass, setShowArchivedClass] = useState(false)
  // 班级筛选: '__ALL__' = 全部, '__NONE__' = 未分班, 其他 = class_id
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  // 数据加载域: 学生/班级/导出格式 + entity_id 自动选中 + 班级派生数据
  const {
    students,
    loading,
    classList,
    exportFormats,
    loadStudents,
    refreshStudents,
    archivedClassIds,
    classIdToName,
    activeClassList,
  } = useStudentList(setSelectedStudent)
  const filtered = useMemo(
    () => filterStudents(students, classFilter, search, archivedClassIds, showArchivedClass),
    [students, classFilter, showArchivedClass, archivedClassIds, search],
  )
  const archivedHiddenCount = useMemo(
    () => countArchivedHidden(students, archivedClassIds),
    [students, archivedClassIds],
  )
  const sorted = useMemo(() => sortStudentsByRisk(filtered), [filtered])
  // 批量选择域: 选择模式/选中集合/批量操作进行态
  const selection = useStudentSelection(sorted)
  // 动作域: 添加/删除/批量调班/批量删除/导入/导出 + 确认对话框 + 右键菜单
  const actions = useStudentActions({
    students,
    classList,
    selectedStudent,
    setSelectedStudent,
    selectedNames: selection.selectedNames,
    batchAssignTarget: selection.batchAssignTarget,
    setBatchAssigning: selection.setBatchAssigning,
    setBatchDeleting: selection.setBatchDeleting,
    exitSelectMode: selection.exitSelectMode,
    loadStudents,
    setActionMessageAuto,
    setAddingStudent,
    newStudentName,
    newStudentClassId,
    setNewStudentName,
    setNewStudentClassId,
  })
  // 学生右键菜单模板 memo 化（所有学生菜单相同，避免每行 JSON.stringify）
  const studentCtxMenu = useMemo(
    () =>
      JSON.stringify([
        { label: t('ctxMenu.viewDetails'), action: 'view' },
        { label: t('ctxMenu.delete'), action: 'delete', variant: 'danger' },
      ]),
    [t],
  )
  return (
    <div className="h-full flex">
      {/* 左侧：学生列表 */}
      <div
        className={`flex flex-col transition-all duration-300 ${selectedStudent ? 'w-[45%]' : 'w-full'}`}
      >
        <PageHeader
          size="md"
          title={`${t('page.students.title', '学生管理')} (${students.length})`}
          subtitle={
            archivedHiddenCount > 0 && !showArchivedClass
              ? t('page.students.archivedHidden').replace('{0}', String(archivedHiddenCount))
              : undefined
          }
          actions={
            <>
              <Button
                onClick={() => setAddingStudent(!addingStudent)}
                icon={<Plus size={14} strokeWidth={2.5} />}
                aria-label={t('page.students.addStudent.aria', '添加学生')}
              >
                {t('page.students.add', '添加')}
              </Button>
              <ImportMenu
                onImportJson={actions.handleImport}
                onImportExcel={actions.handleImportExcel}
                onDownloadTemplate={actions.handleDownloadExcelTemplate}
              />
              <ExportMenu formats={exportFormats} onExport={actions.handleExport} />
              <Button
                variant="secondary"
                onClick={refreshStudents}
                aria-label={t('common.refresh')}
              >
                {t('common.refresh')}
              </Button>
            </>
          }
        />
        {/* 筛选与批量操作工具栏 */}
        <StudentsToolbar
          classFilter={classFilter}
          onClassFilterChange={setClassFilter}
          search={search}
          onSearchChange={setSearch}
          archivedHiddenCount={archivedHiddenCount}
          showArchivedClass={showArchivedClass}
          onShowArchivedClassChange={setShowArchivedClass}
          activeClassList={activeClassList}
          selectMode={selection.selectMode}
          onEnterSelectMode={() => selection.setSelectMode(true)}
          selectedCount={selection.selectedNames.size}
          batchAssignTarget={selection.batchAssignTarget}
          onBatchAssignTargetChange={selection.setBatchAssignTarget}
          batchAssigning={selection.batchAssigning}
          batchDeleting={selection.batchDeleting}
          onBatchAssign={actions.handleBatchAssign}
          onBatchDelete={actions.handleBatchDelete}
          onExitSelectMode={selection.exitSelectMode}
        />
        {actionMessage && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 text-xs border-b border-blue-100 dark:border-blue-900/30 animate-slide-up">
            {actionMessage}
          </div>
        )}
        {/* 添加学生表单 (班级必填) */}
        {addingStudent && (
          <AddStudentForm
            activeClassList={activeClassList}
            newStudentName={newStudentName}
            onNewStudentNameChange={setNewStudentName}
            newStudentClassId={newStudentClassId}
            onNewStudentClassIdChange={setNewStudentClassId}
            onConfirm={actions.handleAddStudent}
            onCancel={() => {
              setAddingStudent(false)
              setNewStudentClassId('')
            }}
          />
        )}
        {/* 双轴滚动兜底: 档案面板打开时左侧仅约 430px,9 列表格需横向滚动而非挤压换行 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <TableSkeleton rows={8} cols={8} />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Users size={28} />}
              title={t('page.students.empty')}
              description={t('page.students.emptyHint', '尝试调整筛选条件或添加新学生')}
            />
          ) : (
            <table className="w-full text-sm min-w-[680px]">
              <thead className={TABLE_STICKY_HEAD}>
                <tr>
                  {selection.selectMode && (
                    <th className={cn(TABLE_TH, 'w-10 text-center')}>
                      <input
                        type="checkbox"
                        checked={selection.allVisibleSelected}
                        onChange={selection.toggleSelectAll}
                        className="accent-blue-500 cursor-pointer"
                        title={t('page.students.batch.selectAll')}
                      />
                    </th>
                  )}
                  <th className={TABLE_TH}>{t('page.students.col.name')}</th>
                  <th className={TABLE_TH}>{t('page.students.col.class', '班级')}</th>
                  <th className={cn(TABLE_TH, 'text-right')}>{t('page.students.col.score')}</th>
                  <th className={cn(TABLE_TH, 'text-right')}>{t('page.students.col.change')}</th>
                  <th className={cn(TABLE_TH, 'text-center')}>{t('page.students.col.risk')}</th>
                  <th className={cn(TABLE_TH, 'text-center')}>{t('page.students.col.events')}</th>
                  <th className={TABLE_TH}>{t('page.students.col.group')}</th>
                  <th className={cn(TABLE_TH, 'text-center')}>{t('page.students.col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <StudentRow
                    key={s.entity_id}
                    student={s}
                    isSelected={selectedStudent?.entity_id === s.entity_id}
                    isSelectMode={selection.selectMode}
                    isChecked={selection.selectedNames.has(s.name)}
                    classNameLabel={s.class_id ? (classIdToName[s.class_id] ?? null) : null}
                    ctxMenuJson={studentCtxMenu}
                    onSelect={setSelectedStudent}
                    onToggleCheck={selection.toggleSelect}
                    onDelete={actions.handleDeleteStudent}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {/* 右侧：学生档案（多选项卡详情） */}
      {selectedStudent && (
        <div className="w-[55%] border-l border-gray-200 dark:border-white/[0.06] flex flex-col overflow-hidden animate-slide-in-right">
          <StudentProfile
            key={selectedStudent.entity_id}
            student={selectedStudent}
            onClose={() => setSelectedStudent(null)}
            onRefresh={loadStudents}
          />
        </div>
      )}
      {/* 自定义确认对话框（替代 window.confirm） */}
      <ConfirmDialog
        open={actions.confirmState.open}
        message={actions.confirmState.message}
        variant={actions.confirmState.variant}
        onConfirm={actions.confirmState.onConfirm}
        onCancel={() => actions.setConfirmState((prev) => ({ ...prev, open: false }))}
      />
      {/* Excel 批量导入：预览确认 + 进度 + 失败清单（M30） */}
      <ExcelImportDialog
        open={actions.excelImport.open}
        preview={actions.excelImport.preview}
        importing={actions.excelImport.importing}
        progress={actions.excelImport.progress}
        result={actions.excelImport.result}
        onConfirm={actions.handleConfirmExcelImport}
        onClose={actions.handleCloseExcelImport}
      />
    </div>
  )
}
