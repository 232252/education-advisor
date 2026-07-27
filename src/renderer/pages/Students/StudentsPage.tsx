// =============================================================
// 学生管理页面 — 列表 + 详情侧边栏（重构版）
// 右侧使用 StudentProfile 多选项卡组件
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { TableSkeleton } from '../../components/Skeleton'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import {
  btnStyle,
  cn,
  INPUT_BASE,
  riskColor,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { StudentProfile } from './StudentProfile'
import {
  countArchivedHidden,
  filterStudents,
  isAllSelected,
  sortStudentsByRisk,
} from './student-filters'

// Electron 文件对话框返回类型
interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}
interface SaveDialogResult {
  canceled: boolean
  filePath: string
}

// RISK_ORDER 已移至 student-filters.ts（纯函数模块，可独立测试）

// P 优化: 将表格行抽成 memo 组件,避免点击切换选中时整表重渲染
interface StudentRowProps {
  student: EAAStudent
  isSelected: boolean
  isSelectMode: boolean
  isChecked: boolean
  classNameLabel: string | null
  ctxMenuJson: string
  onSelect: (s: EAAStudent) => void
  onToggleCheck: (name: string) => void
  onDelete: (name: string) => void
}

const StudentRow = memo(function StudentRow({
  student: s,
  isSelected,
  isSelectMode,
  isChecked,
  classNameLabel,
  ctxMenuJson,
  onSelect,
  onToggleCheck,
  onDelete,
}: StudentRowProps) {
  return (
    <tr
      data-ctx-menu={ctxMenuJson}
      data-ctx-student-name={s.name}
      onClick={() => (isSelectMode ? onToggleCheck(s.name) : onSelect(s))}
      className={cn(
        'cursor-pointer',
        isSelectMode && isChecked
          ? 'border-b border-gray-100 dark:border-white/[0.06] transition-colors bg-blue-600/10 border-l-2 border-l-blue-400'
          : isSelected
            ? 'border-b border-gray-100 dark:border-white/[0.06] transition-colors bg-blue-600/20 border-l-2 border-l-blue-400'
            : TABLE_ROW,
      )}
    >
      {isSelectMode && (
        <td className={TABLE_TD} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleCheck(s.name)}
            className="accent-blue-500 cursor-pointer"
          />
        </td>
      )}
      <td className={cn(TABLE_TD, 'font-medium')}>{s.name}</td>
      <td className={cn(TABLE_TD, 'text-xs text-gray-500 dark:text-gray-400')}>
        {s.class_id ? (
          <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
            {classNameLabel ?? s.class_id}
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">未分班</span>
        )}
      </td>
      <td className={cn(TABLE_TD, 'text-right font-mono')}>{s.score.toFixed(1)}</td>
      <td
        className={cn(
          TABLE_TD,
          'text-right font-mono text-xs',
          s.delta > 0
            ? 'text-green-500 dark:text-green-400'
            : s.delta < 0
              ? 'text-red-500 dark:text-red-400'
              : 'text-gray-400 dark:text-gray-500',
        )}
      >
        {s.delta > 0 ? '+' : ''}
        {s.delta.toFixed(1)}
      </td>
      <td className={cn(TABLE_TD, 'text-center', riskColor(s.risk))}>{s.risk}</td>
      <td className={cn(TABLE_TD, 'text-center text-gray-500 dark:text-gray-400')}>
        {s.events_count}
      </td>
      <td className={TABLE_TD}>
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
      <td className={cn(TABLE_TD, 'text-center')}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(s.name)
          }}
          className="text-red-400/50 hover:text-red-500 dark:hover:text-red-400 text-xs transition-colors"
          title="删除学生"
          aria-label="删除学生"
        >
          删除
        </button>
      </td>
    </tr>
  )
})

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

  // 手动刷新：先清空 EAA 读缓存，再重新加载（强制重新拉取最新数据）
  const refreshStudents = useCallback(async () => {
    try {
      await getAPI().eaa.invalidateCache()
    } catch {
      /* 清缓存失败不阻塞 */
    }
    await loadStudents()
  }, [loadStudents])

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

  // 添加新学生 (班级必填: 学生必须归属于某个班级)
  const handleAddStudent = async () => {
    if (!newStudentName.trim()) return
    if (!newStudentClassId) {
      setActionMessageAuto('请先选择班级')
      return
    }
    try {
      const result = await getAPI().eaa.addStudent(newStudentName.trim())
      // addStudent 不支持直接带 class_id,用 class.assign 串行同步
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

  // 删除学生（使用自定义确认对话框）— PERF: useCallback 稳定引用,避免击穿 StudentRow memo
  const handleDeleteStudent = useCallback(
    (name: string) => {
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
            setActionMessageAuto(t('toast.common.deleteFailed'))
          }
        },
      })
    },
    [t, selectedStudent, loadStudents, setActionMessageAuto],
  )

  // 右键菜单事件处理: 响应 ContextMenu 组件派发的 ctx-menu-action
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ action: string; target: HTMLElement }>
      const action = ce.detail?.action
      const target = ce.detail?.target
      if (!action || !target) return
      const name = target.getAttribute('data-ctx-student-name')
      if (!name) return
      const student = students.find((s) => s.name === name)
      if (!student) return
      if (action === 'view') {
        setSelectedStudent(student)
      } else if (action === 'delete') {
        handleDeleteStudent(name)
      }
    }
    document.addEventListener('ctx-menu-action', handler)
    return () => document.removeEventListener('ctx-menu-action', handler)
    // biome-ignore lint/correctness/useExhaustiveDependencies: handleDeleteStudent is a stable event handler; Tauri biome 2.5.5+ does not flag this
  }, [students, handleDeleteStudent])

  // PERF: filtered 的最新引用 — 让 toggleSelectAll 可以 useCallback([]) 稳定引用
  // 同时不依赖 filtered 的声明顺序(filtered 在下方 useMemo 定义)
  const filteredRef = useRef<EAAStudent[]>([])
  // 在 useMemo(filtered) 后会通过 effect 同步,这里先声明 ref

  // 切换单个学生选中状态 — PERF: useCallback 稳定引用,避免击穿 StudentRow memo
  const toggleSelect = useCallback((name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // 全选/取消全选（作用于当前可见列表）
  // PERF: 通过 filteredRef 读取最新 filtered,稳定 useCallback 引用
  const toggleSelectAll = useCallback(() => {
    setSelectedNames((prev) => {
      // 若当前可见项已全选，则清空；否则全选
      const visibleNames = filteredRef.current.map((s) => s.name)
      const allSelected = visibleNames.length > 0 && visibleNames.every((n) => prev.has(n))
      if (allSelected) {
        const next = new Set(prev)
        for (const n of visibleNames) next.delete(n)
        return next
      }
      const next = new Set(prev)
      for (const n of visibleNames) {
        next.add(n)
      }
      return next
    })
  }, [])

  // 退出选择模式
  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedNames(new Set())
    setBatchAssignTarget('')
  }, [])

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
            toast.error(`${t('toast.students.assignFailed')}: ${res.error ?? t('error.unknown')}`)
          } else {
            const assigned = res.assigned ?? 0
            const failed = res.failed ?? []
            if (failed.length === 0) {
              toast.success(t('toast.students.batchAssignSuccess').replace('{0}', String(assigned)))
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
        toast.success(t('toast.common.importSuccess'))
        loadStudents()
      } else {
        toast.error(`${t('toast.common.importFailed')}: ${getErrorMessage(importResult)}`)
      }
    } catch (err) {
      console.error('[Students] Import failed:', err)
      toast.error(t('toast.common.importFailed'))
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
        toast.success(t('toast.common.exportSuccess'))
      } else {
        toast.error(`${t('toast.common.exportFailed')}: ${getErrorMessage(exportResult)}`)
      }
    } catch (err) {
      console.error('[Students] Export failed:', err)
      toast.error(t('toast.common.exportFailed'))
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

  // 过滤：班级筛选 + 搜索 + 按已存档班级隐藏（逻辑提取到 student-filters.ts）
  const filtered = useMemo(
    () => filterStudents(students, classFilter, search, archivedClassIds, showArchivedClass),
    [students, classFilter, showArchivedClass, archivedClassIds, search],
  )

  // 被隐藏的已存档班级学生数（用于提示）
  const archivedHiddenCount = useMemo(
    () => countArchivedHidden(students, archivedClassIds),
    [students, archivedClassIds],
  )

  // 排序: 高风险优先
  const sorted = useMemo(() => sortStudentsByRisk(filtered), [filtered])

  // PERF: 同步 filtered 到 ref,供 toggleSelectAll 读取最新值而不破坏 useCallback 稳定性
  filteredRef.current = filtered

  // 当前可见列表是否全选
  const allVisibleSelected = useMemo(
    () => isAllSelected(sorted, selectedNames),
    [sorted, selectedNames],
  )

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
          title={`学生管理 (${students.length})`}
          subtitle={
            archivedHiddenCount > 0 && !showArchivedClass
              ? t('page.students.archivedHidden').replace('{0}', String(archivedHiddenCount))
              : undefined
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => setAddingStudent(!addingStudent)}
                className={btnStyle('primary')}
                aria-label="添加学生"
              >
                + 添加
              </button>
              <button
                type="button"
                onClick={handleImport}
                className={btnStyle('secondary')}
                aria-label="导入"
              >
                📥 导入
              </button>
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                  className={btnStyle('secondary')}
                  aria-label="导出"
                >
                  📤 导出
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-[#1a1e28] border border-gray-200 dark:border-white/[0.06] rounded-lg shadow-lg z-50 min-w-[120px] animate-scale-in overflow-hidden">
                    {exportFormats.map((fmt) => (
                      <button
                        type="button"
                        key={fmt}
                        onClick={() => handleExport(fmt)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors first:rounded-t-lg last:rounded-b-lg"
                      >
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={refreshStudents}
                className={btnStyle('secondary')}
                aria-label={t('common.refresh')}
              >
                {t('common.refresh')}
              </button>
            </>
          }
        />
        {/* 筛选与批量操作工具栏 */}
        <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50/50 dark:bg-[#1a1e28]/30">
          {/* 班级筛选下拉 */}
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="bg-white border border-gray-300 dark:bg-[#1e222c] dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
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
            className={cn(INPUT_BASE, 'w-48 px-3 py-1.5 text-sm')}
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
                className="bg-white border border-gray-300 dark:bg-[#1e222c] dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
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
                className={btnStyle('primary')}
                aria-label="调入"
              >
                {batchAssigning ? t('common.loading') : '调入'}
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={selectedNames.size === 0 || batchDeleting}
                className={btnStyle('danger')}
                aria-label={t('page.students.batch.delete')}
              >
                {batchDeleting
                  ? t('common.loading')
                  : `${t('page.students.batch.delete')} (${selectedNames.size})`}
              </button>
              <button
                type="button"
                onClick={exitSelectMode}
                className={btnStyle('secondary')}
                aria-label={t('page.students.batch.cancel')}
              >
                {t('page.students.batch.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className={btnStyle('secondary')}
              aria-label={t('page.students.batch.select')}
            >
              ☑ {t('page.students.batch.select')}
            </button>
          )}
        </div>

        {actionMessage && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 text-xs border-b border-blue-100 dark:border-blue-900/30 animate-slide-up">
            {actionMessage}
          </div>
        )}

        {/* 添加学生表单 (班级必填) */}
        {addingStudent && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#1a1e28]/50 flex gap-2 items-center animate-slide-up">
            {activeClassList.length === 0 ? (
              <div className="flex-1 text-sm text-amber-600 dark:text-amber-400 py-1">
                ⚠ 请先在「班级」页面创建班级，学生必须归属于某个班级
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStudent()
                  }}
                  placeholder={`${t('page.students.col.name')}...`}
                  className={cn('flex-1', INPUT_BASE)}
                />
                <select
                  value={newStudentClassId}
                  onChange={(e) => setNewStudentClassId(e.target.value)}
                  className={INPUT_BASE}
                >
                  <option value="">选择班级 *</option>
                  {activeClassList.map((c) => (
                    <option key={c.class_id} value={c.class_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddStudent}
                  disabled={!newStudentClassId || !newStudentName.trim()}
                  className={btnStyle('primary')}
                  aria-label={t('common.confirm')}
                >
                  {t('common.confirm')}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setAddingStudent(false)
                setNewStudentClassId('')
              }}
              className={btnStyle('secondary')}
              aria-label={t('common.cancel')}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <TableSkeleton rows={8} cols={8} />
          ) : sorted.length === 0 ? (
            <EmptyState
              icon="👥"
              title={t('page.students.empty')}
              description="尝试调整筛选条件或添加新学生"
            />
          ) : (
            <table className="w-full text-sm">
              <thead className={TABLE_STICKY_HEAD}>
                <tr>
                  {selectMode && (
                    <th className={cn(TABLE_TH, 'w-10 text-center')}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        className="accent-blue-500 cursor-pointer"
                        title={t('page.students.batch.selectAll')}
                      />
                    </th>
                  )}
                  <th className={TABLE_TH}>{t('page.students.col.name')}</th>
                  <th className={TABLE_TH}>班级</th>
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
                    isSelectMode={selectMode}
                    isChecked={selectedNames.has(s.name)}
                    classNameLabel={s.class_id ? (classIdToName[s.class_id] ?? null) : null}
                    ctxMenuJson={studentCtxMenu}
                    onSelect={setSelectedStudent}
                    onToggleCheck={toggleSelect}
                    onDelete={handleDeleteStudent}
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
        open={confirmState.open}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
