// =============================================================
// 学生管理页面 — 列表 + 详情侧边栏（重构版）
// 右侧使用 StudentProfile 多选项卡组件
// =============================================================

import type { EAARiskLevel, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { riskColor, riskOrder, riskSortValue } from '../../lib/risk'
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
  const [students, setStudents] = useState<EAAStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<EAAStudent | null>(null)
  const [addingStudent, setAddingStudent] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')

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

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  // 添加新学生
  const handleAddStudent = async () => {
    if (!newStudentName.trim()) return
    try {
      const result = await getAPI().eaa.addStudent(newStudentName.trim())
      setActionMessageAuto(
        result.success
          ? `${t('status.success')}: ${newStudentName}`
          : `${t('status.failed')}: ${getErrorMessage(result)}`,
      )
      setNewStudentName('')
      setAddingStudent(false)
      loadStudents()
    } catch {
      setActionMessageAuto(t('status.failed'))
    }
  }

  // 删除学生（UI 二次确认）
  const handleDeleteStudent = async (name: string) => {
    if (!window.confirm(`${t('common.delete')}: "${name}"?`)) return
    try {
      const result = await getAPI().eaa.deleteStudent(name, { confirm: true, reason: '管理员操作' })
      setActionMessageAuto(
        result.success
          ? `${t('common.delete')}: ${name}`
          : `${t('status.failed')}: ${getErrorMessage(result)}`,
      )
      if (result.success && selectedStudent?.name === name) setSelectedStudent(null)
      if (result.success) loadStudents()
    } catch (err) {
      console.error('[Students] Delete failed:', err)
      setActionMessageAuto(t('status.failed'))
    }
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

  // 过滤
  const searchLower = search.toLowerCase()
  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchLower) ||
      s.groups.some((g) => g.toLowerCase().includes(searchLower)) ||
      s.roles.some((r) => r.toLowerCase().includes(searchLower)),
  )

  // 排序: 高风险优先（使用 lib/risk 共享模块，含未知等级兜底）
  const sorted = [...filtered].sort((a, b) => riskSortValue(a.risk) - riskSortValue(b.risk))

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
                    <td className="py-2.5 px-4 font-medium">{s.name}</td>
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
    </div>
  )
}
