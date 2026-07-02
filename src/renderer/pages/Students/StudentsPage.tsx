// =============================================================
// 学生管理页面 — 列表 + 详情侧边栏（重构版）
// 右侧使用 StudentProfile 多选项卡组件
// =============================================================

import type { ClassEntity, EAARiskLevel, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'
import { StudentProfile } from './StudentProfile'

// Electron 文件对话框返回类型
interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}
interface SaveDialogResult {
  canceled: boolean
  filePath: string
}

// 风险等级颜色
function riskColor(risk: EAARiskLevel): string {
  switch (risk) {
    case '低':
      return 'text-green-500 dark:text-green-400'
    case '中':
      return 'text-yellow-500 dark:text-yellow-400'
    case '高':
      return 'text-orange-500 dark:text-orange-400'
    case '极高':
      return 'text-red-500 dark:text-red-400 font-bold'
  }
}

export function StudentsPage() {
  const { t } = useT()
  const [students, setStudents] = useState<EAAStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<EAAStudent | null>(null)
  const [addingStudent, setAddingStudent] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentClassId, setNewStudentClassId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')
  // 批量选择
  const [selectMode, setSelectMode] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  // 班级（用于按已存档班级隐藏学生 + 班级筛选）
  const [classList, setClassList] = useState<ClassEntity[]>([])
  const [showArchivedClass, setShowArchivedClass] = useState(false)
  // 班级筛选: '__ALL__' = 全部, '__NONE__' = 未分班, 其他 = class_id
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  // 批量调班目标班级
  const [batchAssignTarget, setBatchAssignTarget] = useState<string>('')
  const [batchAssigning, setBatchAssigning] = useState(false)
  // 导出格式：从 EAA 动态获取（fallback 到内置列表）
  // C-2 修复: fallback 列表必须与 EAA Rust 端 cmd_export 一致 (csv/jsonl/html)
  // 之前包含 json 和 markdown,EAA 不支持,选了会报"未知导出格式"错误
  const [exportFormats, setExportFormats] = useState<string[]>(['csv', 'jsonl', 'html'])
  // 从 Dashboard 排行榜跳转时,通过 query param 携带 entity_id 自动选中学生
  const [searchParams, setSearchParams] = useSearchParams()
  // 自定义确认对话框（替代 window.confirm）
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    message: string
    onConfirm: () => void
    variant?: 'default' | 'danger'
  }>({ open: false, message: '', onConfirm: () => {} })

  // 加载学生列表 (过滤掉已删除学生 status=Deleted,避免软删除学生干扰列表)
  const loadStudents = useCallback(async () => {
    try {
      const result = await getAPI().eaa.listStudents()
      if (result.success && result.data?.students) {
        setStudents(result.data.students.filter((s) => s.status !== 'Deleted'))
      }
    } catch (err) {
      console.error('[Students] Failed to load:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // 加载班级列表（用于按已存档班级过滤学生）
  const loadClasses = useCallback(async () => {
    try {
      const res = await getAPI().class.list()
      if (res.success && res.data) setClassList(res.data)
    } catch (err) {
      console.warn('[Students] Failed to load classes:', err)
    }
  }, [])

  // 加载导出格式（从 EAA 获取支持列表，失败时使用 fallback）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const formats = await getAPI().eaa.exportFormats()
        if (!cancelled && Array.isArray(formats) && formats.length > 0) {
          setExportFormats(formats)
        }
      } catch (err) {
        console.warn('[Students] Failed to load export formats, using fallback:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadStudents()
    loadClasses()
  }, [loadStudents, loadClasses])

  // 从 Dashboard 排行榜跳转过来时,学生列表加载完成后按 entity_id 自动选中并打开详情
  useEffect(() => {
    const targetId = searchParams.get('entity_id')
    if (!targetId || loading) return
    // LOW 修复: students 列表为空时(加载完成但无数据),也清除 URL param 并提示,
    // 避免之前直接 return 导致 entity_id param 残留在 URL 中。
    if (students.length === 0) {
      setSearchParams({}, { replace: true })
      toast.warning(`学生列表为空,无法定位 (entity_id: ${targetId})`)
      return
    }
    const match = students.find((s) => s.entity_id === targetId)
    if (match) {
      setSelectedStudent(match)
      // 清除 query param,避免刷新或返回时重复选中
      setSearchParams({}, { replace: true })
    } else {
      // entity_id 不存在: 清除 URL param 避免残留,并提示用户
      setSearchParams({}, { replace: true })
      toast.warning(`未找到该学生 (entity_id: ${targetId})`)
    }
  }, [students, loading, searchParams, setSearchParams])

  // 添加新学生
  const handleAddStudent = async () => {
    if (!newStudentName.trim()) return
    try {
      const result = await getAPI().eaa.addStudent(newStudentName.trim())
      // 若选择了班级,则同时将该学生调入班级 (addStudent 不支持直接带 class_id,用 class.assign 串行同步)
      if (result.success && newStudentClassId) {
        try {
          await getAPI().class.assign({
            class_id: newStudentClassId,
            student_names: [newStudentName.trim()],
          })
        } catch (assignErr) {
          console.warn('[Students] addStudent 后分配班级失败:', assignErr)
        }
      }
      setActionMessageAuto(
        result.success
          ? `${t('status.success')}: ${newStudentName}`
          : `${t('status.failed')}: ${getErrorMessage(result)}`,
      )
      setNewStudentName('')
      setNewStudentClassId('')
      setAddingStudent(false)
      loadStudents()
    } catch {
      setActionMessageAuto(t('status.failed'))
    }
  }

  // 删除学生（使用自定义确认对话框）
  const handleDeleteStudent = (name: string) => {
    setConfirmState({
      open: true,
      message: `${t('common.delete')}: "${name}"?`,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, open: false }))
        try {
          const result = await getAPI().eaa.deleteStudent(name, '管理员操作')
          setActionMessageAuto(
            result.success
              ? `${t('common.delete')}: ${name}`
              : `${t('status.failed')}: ${getErrorMessage(result)}`,
          )
          if (result.success && selectedStudent?.name === name) setSelectedStudent(null)
          if (result.success) loadStudents()
        } catch (err) {
          console.error('[Students] Delete failed:', err)
          setActionMessageAuto('删除失败')
        }
      },
    })
  }

  // 切换单个学生选中状态
  const toggleSelect = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 全选/取消全选（作用于当前排序后的可见列表）
  const toggleSelectAll = () => {
    setSelectedNames((prev) => {
      // 若当前可见项已全选，则清空；否则全选
      const visibleNames = sorted.map((s) => s.name)
      const allSelected = visibleNames.length > 0 && visibleNames.every((n) => prev.has(n))
      if (allSelected) {
        const next = new Set(prev)
        for (const n of visibleNames) next.delete(n)
        return next
      }
      const next = new Set(prev)
      for (const n of visibleNames) next.add(n)
      return next
    })
  }

  // 退出选择模式
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedNames(new Set())
    setBatchAssignTarget('')
  }

  // 批量调班：将选中学生分入指定班级
  const handleBatchAssign = () => {
    const names = Array.from(selectedNames)
    if (names.length === 0 || !batchAssignTarget) return
    const targetClass = classList.find((c) => c.class_id === batchAssignTarget)
    setConfirmState({
      open: true,
      message: `确认将选中的 ${names.length} 名学生调入「${targetClass?.name ?? batchAssignTarget}」?`,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, open: false }))
        setBatchAssigning(true)
        try {
          const res = await getAPI().class.assign({
            class_id: batchAssignTarget,
            student_names: names,
          })
          if (!res.success) {
            toast.error(`调班失败: ${res.error ?? '未知错误'}`)
          } else {
            const assigned = res.assigned ?? 0
            const failed = res.failed ?? []
            if (failed.length === 0) {
              toast.success(`成功调入 ${assigned} 名学生`)
            } else {
              toast.warning(
                `调入 ${assigned} 名, 失败 ${failed.length} 名: ${failed.slice(0, 3).join('; ')}`,
              )
            }
          }
          exitSelectMode()
          await loadStudents()
        } catch (err) {
          toast.error(`调班异常: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBatchAssigning(false)
        }
      },
    })
  }

  // 批量删除选中学生（使用自定义确认对话框，danger 变体）
  const handleBatchDelete = () => {
    const names = Array.from(selectedNames)
    if (names.length === 0) return
    setConfirmState({
      open: true,
      message: t('page.students.batch.delete.confirm').replace('{0}', String(names.length)),
      variant: 'danger',
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, open: false }))
        setBatchDeleting(true)
        let ok = 0
        let fail = 0
        // 串行调用：EAA 写操作有内部队列，串行更稳妥
        for (const name of names) {
          try {
            const r = await getAPI().eaa.deleteStudent(name, '管理员批量操作')
            if (r.success) {
              ok++
              if (selectedStudent?.name === name) setSelectedStudent(null)
            } else {
              fail++
              console.warn(`[Students] Batch delete failed for ${name}:`, getErrorMessage(r))
            }
          } catch (err) {
            fail++
            console.error(`[Students] Batch delete error for ${name}:`, err)
          }
        }
        setBatchDeleting(false)
        setActionMessageAuto(
          t('page.students.batch.deleted')
            .replace('{0}', String(ok))
            .replace('{1}', String(ok + fail)),
        )
        exitSelectMode()
        await loadStudents()
      },
    })
  }

  // 批量导入学生
  const handleImport = async () => {
    try {
      const result = (await getAPI().sys.openDialog({
        title: '选择导入文件',
        filters: [
          { name: 'CSV', extensions: ['csv'] },
          { name: 'JSON', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })) as OpenDialogResult
      if (result.canceled || !result.filePaths?.length) return
      const filePath = result.filePaths[0]
      const importResult = await getAPI().eaa.import(filePath)
      if (importResult.success) {
        toast.success('导入成功')
        loadStudents()
      } else {
        toast.error(`导入失败: ${getErrorMessage(importResult)}`)
      }
    } catch (err) {
      console.error('[Students] Import failed:', err)
      toast.error('导入失败')
    }
  }

  // 导出排名
  const handleExport = async (format: string) => {
    setExportMenuOpen(false)
    try {
      const ext = format === 'markdown' ? 'md' : format
      const result = (await getAPI().sys.saveDialog({
        title: '导出排名',
        defaultPath: `ranking.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      })) as SaveDialogResult
      if (!result || result.canceled) return
      const filePath = result.filePath
      const exportResult = await getAPI().eaa.export(format, filePath)
      if (exportResult.success) {
        toast.success('导出成功')
      } else {
        toast.error(`导出失败: ${getErrorMessage(exportResult)}`)
      }
    } catch (err) {
      console.error('[Students] Export failed:', err)
      toast.error('导出失败')
    }
  }

  // 点击外部关闭导出下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [exportMenuOpen])

  // 已存档的班级 class_id 集合（用于默认隐藏这些班级的学生）
  const archivedClassIds = useMemo(
    () => new Set(classList.filter((c) => c.archived).map((c) => c.class_id)),
    [classList],
  )

  // class_id → 班级名称 映射（用于表格显示）
  const classIdToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of classList) m[c.class_id] = c.name
    return m
  }, [classList])

  // 活跃班级列表（用于筛选下拉 + 批量调班目标下拉）
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  // 过滤：班级筛选 + 搜索 + 按已存档班级隐藏
  const filtered = students.filter((s) => {
    // 班级筛选
    if (classFilter === '__NONE__') {
      if (s.class_id) return false
    } else if (classFilter !== '__ALL__') {
      if (s.class_id !== classFilter) return false
    }
    // 默认隐藏已存档班级的学生（除非用户开启"显示已存档班级学生"）
    if (!showArchivedClass && s.class_id && archivedClassIds.has(s.class_id)) return false
    return (
      s.name.includes(search) ||
      s.groups.some((g) => g.includes(search)) ||
      s.roles.some((r) => r.includes(search))
    )
  })

  // 被隐藏的已存档班级学生数（用于提示）
  const archivedHiddenCount = useMemo(
    () => students.filter((s) => s.class_id && archivedClassIds.has(s.class_id)).length,
    [students, archivedClassIds],
  )

  // 排序: 高风险优先
  const riskOrder: Record<EAARiskLevel, number> = { 极高: 0, 高: 1, 中: 2, 低: 3 }
  const sorted = [...filtered].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])

  // 当前可见列表是否全选
  const allVisibleSelected = sorted.length > 0 && sorted.every((s) => selectedNames.has(s.name))

  return (
    <div className="h-full flex">
      {/* 左侧：学生列表 */}
      <div className={`flex flex-col transition-all ${selectedStudent ? 'w-[45%]' : 'w-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-wrap gap-2">
          <h1 className="text-xl font-bold">
            学生管理 ({students.length})
            {archivedHiddenCount > 0 && !showArchivedClass && (
              <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                {t('page.students.archivedHidden').replace('{0}', String(archivedHiddenCount))}
              </span>
            )}
          </h1>
          <div className="flex gap-2 items-center flex-wrap">
            {/* 班级筛选下拉 */}
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              title="按班级筛选"
            >
              <option value="__ALL__">全部班级</option>
              <option value="__NONE__">未分班</option>
              {activeClassList.map((c) => (
                <option key={c.id} value={c.class_id}>
                  {c.name} ({c.class_id})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索姓名/分组/角色..."
              className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm w-48
                         focus:outline-none focus:border-blue-500"
            />
            {archivedHiddenCount > 0 && (
              <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchivedClass}
                  onChange={(e) => setShowArchivedClass(e.target.checked)}
                  className="accent-blue-500"
                />
                {t('page.students.showArchived')}
              </label>
            )}
            {selectMode ? (
              <>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('page.students.batch.selected').replace('{0}', String(selectedNames.size))}
                </span>
                {/* 批量调班 */}
                <select
                  value={batchAssignTarget}
                  onChange={(e) => setBatchAssignTarget(e.target.value)}
                  className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                  title="选择目标班级"
                >
                  <option value="">调入班级...</option>
                  {activeClassList.map((c) => (
                    <option key={c.id} value={c.class_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleBatchAssign}
                  disabled={selectedNames.size === 0 || !batchAssignTarget || batchAssigning}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm text-white transition-colors"
                >
                  {batchAssigning ? t('common.loading') : '调入'}
                </button>
                <button
                  type="button"
                  onClick={handleBatchDelete}
                  disabled={selectedNames.size === 0 || batchDeleting}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm text-white transition-colors"
                >
                  {batchDeleting
                    ? t('common.loading')
                    : `${t('page.students.batch.delete')} (${selectedNames.size})`}
                </button>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1.5 text-sm"
                >
                  {t('page.students.batch.cancel')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelectMode(true)}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
              >
                ☑ {t('page.students.batch.select')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddingStudent(!addingStudent)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              + 添加
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              📥 导入
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
              >
                📤 导出
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[120px]">
                  {exportFormats.map((fmt) => (
                    <button
                      type="button"
                      key={fmt}
                      onClick={() => handleExport(fmt)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={loadStudents}
              className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {t('common.refresh')}
            </button>
          </div>
        </div>

        {actionMessage && (
          <div className="px-4 py-2 bg-blue-500/20 text-blue-600 dark:text-blue-300 text-xs">
            {actionMessage}
          </div>
        )}

        {/* 添加学生表单 */}
        {addingStudent && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex gap-2 items-center">
            <input
              type="text"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddStudent()
              }}
              placeholder={`${t('page.students.col.name')}...`}
              className="flex-1 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm
                         focus:outline-none focus:border-blue-500"
            />
            <select
              value={newStudentClassId}
              onChange={(e) => setNewStudentClassId(e.target.value)}
              className="bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">不分班</option>
              {activeClassList.map((c) => (
                <option key={c.class_id} value={c.class_id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddStudent}
              className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingStudent(false)
                setNewStudentClassId('')
              }}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1.5 text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12">
              {t('common.loading')}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12">
              {t('page.students.empty')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs">
                  {selectMode && (
                    <th className="py-2 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        className="accent-blue-500 cursor-pointer"
                        title={t('page.students.batch.selectAll')}
                      />
                    </th>
                  )}
                  <th className="text-left py-2 px-4">{t('page.students.col.name')}</th>
                  <th className="text-left py-2 px-4">班级</th>
                  <th className="text-right py-2 px-4">{t('page.students.col.score')}</th>
                  <th className="text-right py-2 px-4">{t('page.students.col.change')}</th>
                  <th className="text-center py-2 px-4">{t('page.students.col.risk')}</th>
                  <th className="text-center py-2 px-4">{t('page.students.col.events')}</th>
                  <th className="text-left py-2 px-4">{t('page.students.col.group')}</th>
                  <th className="text-center py-2 px-4">{t('page.students.col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.entity_id}
                    onClick={() => (selectMode ? toggleSelect(s.name) : setSelectedStudent(s))}
                    className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors
                      ${
                        selectMode && selectedNames.has(s.name)
                          ? 'bg-blue-600/10 border-l-2 border-l-blue-400'
                          : selectedStudent?.entity_id === s.entity_id
                            ? 'bg-blue-600/20 border-l-2 border-l-blue-400'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
                      }`}
                  >
                    {selectMode && (
                      <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedNames.has(s.name)}
                          onChange={() => toggleSelect(s.name)}
                          className="accent-blue-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="py-2.5 px-4 font-medium">{s.name}</td>
                    <td className="py-2.5 px-4 text-xs text-gray-500 dark:text-gray-400">
                      {s.class_id ? (
                        <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          {classIdToName[s.class_id] ?? s.class_id}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">未分班</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">{s.score.toFixed(1)}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono text-xs ${
                        s.delta > 0
                          ? 'text-green-500 dark:text-green-400'
                          : s.delta < 0
                            ? 'text-red-500 dark:text-red-400'
                            : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {s.delta > 0 ? '+' : ''}
                      {s.delta.toFixed(1)}
                    </td>
                    <td className={`py-2.5 px-4 text-center ${riskColor(s.risk)}`}>{s.risk}</td>
                    <td className="py-2.5 px-4 text-center text-gray-500 dark:text-gray-400">
                      {s.events_count}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {s.groups.map((g) => (
                          <span
                            key={g}
                            className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded"
                          >
                            {g}
                          </span>
                        ))}
                        {s.roles.map((r) => (
                          <span
                            key={r}
                            className="text-[10px] bg-blue-500/20 text-blue-500 dark:text-blue-400 px-1.5 py-0.5 rounded"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteStudent(s.name)
                        }}
                        className="text-red-400/50 hover:text-red-500 dark:hover:text-red-400 text-xs transition-colors"
                        title="删除学生"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 右侧：学生档案（多选项卡详情） */}
      {selectedStudent && (
        <div className="w-[55%] border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
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
        open={confirmState.open}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
