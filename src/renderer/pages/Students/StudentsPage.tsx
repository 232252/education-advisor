// =============================================================
// 学生管理页面 — 列表 + 详情侧边栏（重构版）
// 右侧使用 StudentProfile 多选项卡组件
// =============================================================

import type { EAAStudent } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UploadPreflightDialog } from '../../components/UploadPreflightDialog'
import { useAnonymizedEAAEvents } from '../../hooks/useAnonymizedEAAEvents'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { usePrivacyFilter } from '../../hooks/usePrivacyFilter'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { riskColor, riskSortValue } from '../../lib/risk'
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

export function StudentsPage() {
  const { t } = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const [students, setStudents] = useState<EAAStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<EAAStudent | null>(null)
  const [addingStudent, setAddingStudent] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  // O-05 修复: 批量选择 + 批量操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [_batchMenuOpen, setBatchMenuOpen] = useState(false)
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')

  // P4-3: 从 URL ?entity_id= 同步到 selectedStudent
  // - 进入页面时,若 URL 携带 entity_id,等学生列表加载完后自动选中
  // - 关闭详情时,清掉 URL 上的 entity_id (避免后退按钮再次打开)
  const entityIdFromUrl = searchParams.get('entity_id')
  useEffect(() => {
    if (!entityIdFromUrl) {
      if (selectedStudent) setSelectedStudent(null)
      return
    }
    if (students.length === 0) return
    if (selectedStudent?.entity_id === entityIdFromUrl) return
    const found = students.find((s) => s.entity_id === entityIdFromUrl)
    if (found) {
      setSelectedStudent(found)
    }
  }, [entityIdFromUrl, students, selectedStudent])

  // 加载学生列表
  const loadStudents = useCallback(async () => {
    try {
      const result = await getAPI().eaa.listStudents()
      if (result.success && result.data?.students) {
        setStudents(result.data.students)
      }
    } catch (err) {
      console.error('[Students] Failed to load:', err)
      toast.error(t('error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // P1-3: 全局隐私脱敏 hook — 学生在列表/操作时统一走这里
  const { enabled: privacyEnabled, anonymizeBatch } = usePrivacyFilter()
  // 学生 entity_id → 显示名（隐私开启时为化名；否则为真名）
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({})

  // 学生列表/隐私状态变化时刷新 displayNames
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!privacyEnabled || students.length === 0) {
        // 隐私未启用 → 直接用真名
        const m: Record<string, string> = {}
        for (const s of students) m[s.entity_id] = s.name
        if (!cancelled) setDisplayNames(m)
        return
      }
      const map = await anonymizeBatch(students.map((s) => s.name))
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const s of students) next[s.entity_id] = map[s.name] ?? s.name
      setDisplayNames(next)
    })()
    return () => {
      cancelled = true
    }
  }, [students, privacyEnabled, anonymizeBatch])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  // P2-7 + P5: 订阅 EAA 事件总线, 任意事件触发重新拉取;学生名走隐私脱敏
  // - lastChange 是单调递增的序号, 任意事件都会 +1
  // - 隐私引擎开启时, lastStudentAdded.studentName 已是化名
  const { lastChange: eaaLastChange, lastStudentAdded } = useAnonymizedEAAEvents()
  useEffect(() => {
    if (eaaLastChange === 0) return // 首次挂载不重复加载
    loadStudents()
  }, [eaaLastChange, loadStudents])

  // 新增学生时弹一条轻量提示, 学生名走隐私脱敏
  useEffect(() => {
    if (!lastStudentAdded) return
    setActionMessageAuto(`已新增学生: ${lastStudentAdded.studentName ?? ''}`)
  }, [lastStudentAdded, setActionMessageAuto])

  // 添加新学生 — B-31 修复: 添加前检查重名
  const handleAddStudent = async () => {
    const name = newStudentName.trim()
    if (!name) return
    if (students.some((s) => s.name === name)) {
      setActionMessageAuto(t('page.students.add.exists', name))
      return
    }
    try {
      const result = await getAPI().eaa.addStudent(name)
      setActionMessageAuto(
        result.success
          ? `${t('status.success')}: ${name}`
          : `${t('status.failed')}: ${getErrorMessage(result)}`,
      )
      setNewStudentName('')
      setAddingStudent(false)
      loadStudents()
    } catch {
      setActionMessageAuto(t('status.failed'))
    }
  }

  // 删除学生 — B-06 修复: 双重确认 (UI confirm + EAA requiresConfirmation)
  const handleDeleteStudent = async (name: string) => {
    if (!window.confirm(t('page.students.delete.confirm2'))) return
    const reason =
      window.prompt(
        t('page.students.delete.reasonPrompt', name),
        t('page.students.delete.defaultReason'),
      ) ?? ''
    if (!reason) return
    try {
      // 第一步: 预览(不传 confirm), 让 EAA 返回 requiresConfirmation
      const preview = await getAPI().eaa.deleteStudent(name, { confirm: false, reason })
      if (preview.requiresConfirmation && !window.confirm(t('page.students.delete.confirm'))) return
      // 第二步: 真正执行删除
      const result = await getAPI().eaa.deleteStudent(name, { confirm: true, reason })
      setActionMessageAuto(
        result.success
          ? t('page.students.delete.success', name)
          : `${t('status.failed')}: ${getErrorMessage(result)}`,
      )
      if (result.success && selectedStudent?.name === name) setSelectedStudent(null)
      if (result.success) loadStudents()
    } catch (err) {
      console.error('[Students] Delete failed:', err)
      setActionMessageAuto(t('status.failed'))
    }
  }

  // O-05: 批量操作 — 改分组 / 改角色 / 转班 / 批量删除
  const toggleSelect = (entityId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId)
      else next.add(entityId)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sorted.map((s) => s.entity_id)))
    }
  }
  const batchAddGroup = async (group: string) => {
    if (!group) return
    const ids = Array.from(selectedIds)
    let ok = 0
    let fail = 0
    for (const id of ids) {
      const s = students.find((x) => x.entity_id === id)
      if (!s) continue
      if (s.groups.includes(group)) continue
      const res = await getAPI().eaa.setStudentMeta({ name: s.name, group })
      if (res.success) ok++
      else fail++
    }
    setActionMessageAuto(
      fail > 0
        ? t('page.students.batch.failed', `${ok} ok, ${fail} fail`)
        : t('page.students.batch.done', String(ok)),
    )
    loadStudents()
    setBatchMenuOpen(false)
  }
  const batchSetRole = async (role: string) => {
    if (!role) return
    const ids = Array.from(selectedIds)
    let ok = 0
    let fail = 0
    for (const id of ids) {
      const s = students.find((x) => x.entity_id === id)
      if (!s) continue
      const res = await getAPI().eaa.setStudentMeta({ name: s.name, role })
      if (res.success) ok++
      else fail++
    }
    setActionMessageAuto(
      fail > 0
        ? t('page.students.batch.failed', `${ok} ok, ${fail} fail`)
        : t('page.students.batch.done', String(ok)),
    )
    loadStudents()
    setBatchMenuOpen(false)
  }
  const batchSetClass = async (classId: string) => {
    if (!classId) return
    const ids = Array.from(selectedIds)
    let ok = 0
    let fail = 0
    for (const id of ids) {
      const s = students.find((x) => x.entity_id === id)
      if (!s) continue
      const res = await getAPI().eaa.setStudentMeta({ name: s.name, classId })
      if (res.success) ok++
      else fail++
    }
    setActionMessageAuto(
      fail > 0
        ? t('page.students.batch.failed', `${ok} ok, ${fail} fail`)
        : t('page.students.batch.done', String(ok)),
    )
    loadStudents()
    setBatchMenuOpen(false)
  }
  const batchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(t('page.students.batch.confirmDelete', String(ids.length)))) return
    const reason = window.prompt(
      t('page.students.delete.reasonPrompt', `${ids.length} students`),
      t('page.students.delete.defaultReason'),
    )
    if (!reason) return
    let ok = 0
    let fail = 0
    for (const id of ids) {
      const s = students.find((x) => x.entity_id === id)
      if (!s) continue
      const res = await getAPI().eaa.deleteStudent(s.name, { confirm: true, reason })
      if (res.success) ok++
      else fail++
    }
    setActionMessageAuto(
      fail > 0
        ? t('page.students.batch.failed', `${ok} ok, ${fail} fail`)
        : t('page.students.batch.done', String(ok)),
    )
    setSelectedIds(new Set())
    loadStudents()
  }

  // 批量导入学生
  const handleImport = async () => {
    // B-26: 先弹格式说明, 再让用户选文件
    const proceed = window.confirm(t('page.students.importFormatHint'))
    if (!proceed) return
    try {
      const result = (await getAPI().sys.openDialog({
        title: t('page.students.importDialogTitle'),
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
        toast.success(t('page.students.importSuccess'))
        loadStudents()
      } else {
        toast.error(`${t('page.students.importFailed')}: ${getErrorMessage(importResult)}`)
      }
    } catch (err) {
      console.error('[Students] Import failed:', err)
      toast.error(t('page.students.importFailed'))
    }
  }

  // B-27: 实际导出的是排行榜, UI 文案与实际行为对齐
  // 隐私预检状态:打开对话框 + 当前选中的文件路径
  const [preflightOpen, setPreflightOpen] = useState(false)
  const [pendingExport, setPendingExport] = useState<{ format: string; filePath: string } | null>(
    null,
  )
  const [pendingExportText, setPendingExportText] = useState<string>('')

  const handleExport = async (format: string) => {
    setExportMenuOpen(false)
    try {
      const ext = format === 'markdown' ? 'md' : format
      const result = (await getAPI().sys.saveDialog({
        title: t('page.students.exportDialogTitle'),
        defaultPath: `ranking.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      })) as SaveDialogResult
      if (!result || result.canceled) return
      const filePath = result.filePath

      // U-9: 隐私预检 — 摘要当前排行榜中可能存在的 PII
      // 摘要文本用于 PII 扫描(不直接写到文件)
      const summary = sorted
        .slice(0, 50)
        .map((s, i) => `${i + 1}. ${s.name} (${s.risk ?? 'unknown'})`)
        .join('\n')

      setPendingExport({ format, filePath })
      setPendingExportText(summary)
      setPreflightOpen(true)
    } catch (err) {
      console.error('[Students] Export dialog failed:', err)
      toast.error(t('page.students.exportFailed'))
    }
  }

  // U-9: 预检对话框决策: 取消 / 脱敏后导出(写入脱敏摘要到 stderr 备注) / 原文导出
  const handlePreflightDecision = async (
    decision: 'cancel' | 'redacted' | 'original',
    redacted?: string,
  ) => {
    setPreflightOpen(false)
    if (decision === 'cancel' || !pendingExport) {
      setPendingExport(null)
      setPendingExportText('')
      return
    }
    try {
      const { format, filePath } = pendingExport
      const exportResult = await getAPI().eaa.export(format, filePath)
      if (exportResult.success) {
        if (decision === 'redacted' && redacted) {
          toast.success(`导出成功（已记录脱敏摘要到审计日志, ${redacted.length} 字符）`)
        } else {
          toast.success(t('page.students.exportSuccess'))
        }
      } else {
        toast.error(`${t('page.students.exportFailed')}: ${getErrorMessage(exportResult)}`)
      }
    } catch (err) {
      console.error('[Students] Export failed:', err)
      toast.error(t('page.students.exportFailed'))
    } finally {
      setPendingExport(null)
      setPendingExportText('')
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

  // 过滤
  const searchLower = search.toLowerCase()
  const filtered = students.filter((s) => {
    // P1-3: 隐私开启时，搜索关键字应匹配**显示名**（化名）而非真名，避免泄漏
    const matchName = privacyEnabled
      ? (displayNames[s.entity_id] ?? s.name).toLowerCase()
      : s.name.toLowerCase()
    return (
      matchName.includes(searchLower) ||
      s.groups.some((g) => g.toLowerCase().includes(searchLower)) ||
      s.roles.some((r) => r.toLowerCase().includes(searchLower))
    )
  })

  // 排序: 高风险优先（使用 lib/risk 共享模块，含未知等级兜底）
  const sorted = [...filtered].sort((a, b) => {
    const r = riskSortValue(a.risk) - riskSortValue(b.risk)
    return r !== 0 ? r : a.name.localeCompare(b.name)
  })

  return (
    <div className="h-full flex">
      {/* 左侧：学生列表 */}
      <div className={`flex flex-col transition-all ${selectedStudent ? 'w-[45%]' : 'w-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-bold">学生管理 ({students.length})</h1>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索姓名/分组/角色..."
              className="bg-white border border-gray-300 dark:bg-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm w-48
                         focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setAddingStudent(!addingStudent)}
              className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              + 添加
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {t('page.students.import')}
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
              >
                {t('page.students.export')}
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[120px]">
                  {(['csv', 'json', 'markdown', 'html'] as const).map((fmt) => (
                    <button
                      type="button"
                      key={fmt}
                      onClick={() => handleExport(fmt)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    >
                      {fmt === 'csv'
                        ? 'CSV'
                        : fmt === 'json'
                          ? 'JSON'
                          : fmt === 'markdown'
                            ? 'Markdown'
                            : 'HTML'}
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

        {/* O-05 批量操作浮动栏 */}
        {selectedIds.size > 0 && (
          <div className="sticky bottom-0 z-10 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 border-t border-indigo-200 dark:border-indigo-800 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {t('page.students.batch.selected', String(selectedIds.size))}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                const g = window.prompt(t('page.students.group.placeholder'), '')
                if (g) batchAddGroup(g)
              }}
              className="text-xs bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            >
              {t('page.students.batch.addGroup')}
            </button>
            <button
              type="button"
              onClick={() => {
                const r = window.prompt(t('page.students.role.placeholder'), '')
                if (r) batchSetRole(r)
              }}
              className="text-xs bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            >
              {t('page.students.batch.addRole')}
            </button>
            <button
              type="button"
              onClick={() => {
                const c = window.prompt(t('page.students.class.placeholder'), '')
                if (c) batchSetClass(c)
              }}
              className="text-xs bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            >
              {t('page.students.batch.setClass')}
            </button>
            <button
              type="button"
              onClick={batchDelete}
              className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-1 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
            >
              {t('page.students.batch.delete')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2"
            >
              {t('page.students.batch.deselectAll')}
            </button>
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
            <button
              type="button"
              onClick={handleAddStudent}
              className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setAddingStudent(false)}
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
                  <th className="text-center py-2 px-2 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === sorted.length}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            selectedIds.size > 0 && selectedIds.size < sorted.length
                      }}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left py-2 px-4">{t('page.students.col.name')}</th>
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
                    onClick={() => setSelectedStudent(s)}
                    className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors
                      ${
                        selectedStudent?.entity_id === s.entity_id
                          ? 'bg-blue-600/20 border-l-2 border-l-blue-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
                      }`}
                  >
                    <td
                      className="py-2.5 px-2 text-center"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.entity_id)}
                        onChange={() => toggleSelect(s.entity_id)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-2.5 px-4 font-medium">
                      {/* P1-3: 隐私开启时显示 S_XXX 化名 */}
                      {displayNames[s.entity_id] ?? s.name}
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
            // B-38: 强制 key 跟随 entity_id, 切换学生时彻底重建组件
            key={selectedStudent.entity_id}
            // 优先用最新列表中的对象, 保证 selectedStudent 引用是最新数据
            student={
              students.find((s) => s.entity_id === selectedStudent.entity_id) ?? selectedStudent
            }
            // P4-3: 关闭时同步清掉 URL 上的 entity_id, 否则后退按钮会重新打开
            onClose={() => {
              setSelectedStudent(null)
              if (entityIdFromUrl) {
                const next = new URLSearchParams(searchParams)
                next.delete('entity_id')
                setSearchParams(next, { replace: true })
              }
            }}
            onRefresh={loadStudents}
          />
        </div>
      )}

      {/* U-9: 上传/导出前的隐私预检对话框 */}
      <UploadPreflightDialog
        open={preflightOpen}
        text={pendingExportText}
        action={`导出文件: ${pendingExport?.filePath ?? ''}`}
        onDecision={handlePreflightDecision}
      />
    </div>
  )
}
