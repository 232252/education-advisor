// =============================================================
// useStudentActions — 学生动作域 hook
// 封装 添加/删除/批量调班/批量删除/导入(JSON+Excel)/导出 等 handler,
// confirmState 确认对话框管理,以及右键菜单 ctx-menu-action 事件监听。
// M30: Excel 批量导入(解析预览 → 确认导入 → 进度/失败清单)。
// 依赖通过参数注入,返回所有 handler + confirmState + setConfirmState。
// =============================================================

import type {
  ClassEntity,
  EAAStudent,
  StudentImportPreview,
  StudentImportProgress,
  StudentImportResult,
} from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { ConfirmState, OpenDialogResult, SaveDialogResult } from '../types'

/** Excel 导入对话框状态（M30：解析预览 → 确认导入 → 结果/失败清单） */
export interface ExcelImportState {
  open: boolean
  preview: StudentImportPreview | null
  importing: boolean
  progress: StudentImportProgress | null
  result: StudentImportResult | null
}

interface UseStudentActionsOptions {
  /** 全部学生（右键菜单按姓名查找） */
  students: EAAStudent[]
  /** 班级列表（批量调班确认提示中显示目标班级名） */
  classList: ClassEntity[]
  /** 当前选中学生（删除时联动关闭详情） */
  selectedStudent: EAAStudent | null
  setSelectedStudent: (s: EAAStudent | null) => void
  /** 批量选中学生姓名集合 */
  selectedNames: Set<string>
  /** 批量调班目标班级 */
  batchAssignTarget: string
  setBatchAssigning: (value: boolean) => void
  setBatchDeleting: (value: boolean) => void
  /** 退出批量选择模式（批量操作完成后调用） */
  exitSelectMode: () => void
  /** 重新加载学生列表 */
  loadStudents: () => Promise<void>
  /** 操作提示消息（自动消失） */
  setActionMessageAuto: (message: string) => void
  /** 添加表单开关 */
  setAddingStudent: (value: boolean) => void
  newStudentName: string
  newStudentClassId: string
  setNewStudentName: (value: string) => void
  setNewStudentClassId: (value: string) => void
}

export function useStudentActions({
  students,
  classList,
  selectedStudent,
  setSelectedStudent,
  selectedNames,
  batchAssignTarget,
  setBatchAssigning,
  setBatchDeleting,
  exitSelectMode,
  loadStudents,
  setActionMessageAuto,
  setAddingStudent,
  newStudentName,
  newStudentClassId,
  setNewStudentName,
  setNewStudentClassId,
}: UseStudentActionsOptions) {
  const { t } = useT()
  // 自定义确认对话框（替代 window.confirm）
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: '',
    onConfirm: () => {},
  })
  // Excel 导入对话框状态（M30）
  const [excelImport, setExcelImport] = useState<ExcelImportState>({
    open: false,
    preview: null,
    importing: false,
    progress: null,
    result: null,
  })

  // 添加新学生 (班级必填: 学生必须归属于某个班级)
  const handleAddStudent = async () => {
    if (!newStudentName.trim()) return
    if (!newStudentClassId) {
      setActionMessageAuto(t('page.students.addStudent.selectClassFirst', '请先选择班级'))
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
    [t, selectedStudent, loadStudents, setActionMessageAuto, setSelectedStudent],
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
  }, [students, handleDeleteStudent, setSelectedStudent])

  // 批量调班：将选中学生分入指定班级
  const handleBatchAssign = () => {
    const names = Array.from(selectedNames)
    if (names.length === 0 || !batchAssignTarget) return
    const targetClass = classList.find((c) => c.class_id === batchAssignTarget)
    setConfirmState({
      open: true,
      message: t('page.students.batch.assignConfirm', '确认将选中的 {0} 名学生调入「{1}」?')
        .replace('{0}', String(names.length))
        .replace('{1}', targetClass?.name ?? batchAssignTarget),
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
                `${t('page.students.batch.assignPartial', '调入 {0} 名, 失败 {1} 名')
                  .replace('{0}', String(assigned))
                  .replace('{1}', String(failed.length))}: ${failed.slice(0, 3).join('; ')}`,
              )
            }
          }
          exitSelectMode()
          await loadStudents()
        } catch (err) {
          toast.error(
            `${t('toast.students.assignException', '调班异常')}: ${err instanceof Error ? err.message : String(err)}`,
          )
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
        title: t('page.students.import.dialogTitle', '选择导入文件'),
        // main 侧 buildImportArgs 只支持 .json/.jsonl(Rust 端 serde_json 导入),
        // 不再提供 CSV 选项避免用户选中后被拒绝
        filters: [{ name: 'JSON', extensions: ['json', 'jsonl'] }],
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

  // Excel 批量导入（M30）：选文件 → 主进程 parse-excel → 预览对话框确认
  const handleImportExcel = async () => {
    try {
      const result = (await getAPI().sys.openDialog({
        title: t('page.students.import.excel.dialogTitle', '选择 Excel 文件'),
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })) as OpenDialogResult
      if (result.canceled || !result.filePaths?.length) return
      const filePath = result.filePaths[0]
      const preview = await getAPI().students.parseExcel(filePath)
      if (!preview.success) {
        toast.error(
          `${t('page.students.import.excel.parseFailed')}: ${preview.error ?? t('error.unknown')}`,
        )
        return
      }
      if (preview.rows.length === 0 && preview.errors.length === 0) {
        toast.warning(t('page.students.import.excel.emptyFile'))
        return
      }
      setExcelImport({ open: true, preview, importing: false, progress: null, result: null })
    } catch (err) {
      console.error('[Students] Excel import parse failed:', err)
      toast.error(t('page.students.import.excel.parseFailed'))
    }
  }

  // Excel 导入确认：订阅进度推送 → 逐条 add-student → 展示结果/失败清单
  const handleConfirmExcelImport = async () => {
    const preview = excelImport.preview
    if (!preview || excelImport.importing) return
    setExcelImport((prev) => ({ ...prev, importing: true, progress: null }))
    // 仅导入期间订阅进度事件（主进程串行 spawn 较慢，实时推送）
    const unsubscribe = getAPI().students.onImportProgress((data) => {
      setExcelImport((prev) => ({ ...prev, progress: data }))
    })
    try {
      const result = await getAPI().students.importExcel({
        rows: preview.rows.map((r) => ({ row: r.row, name: r.name, classId: r.classId })),
      })
      if (!result.success) {
        toast.error(`${t('toast.common.importFailed')}: ${result.error ?? t('error.unknown')}`)
        setExcelImport((prev) => ({ ...prev, importing: false }))
        return
      }
      setExcelImport((prev) => ({ ...prev, importing: false, result }))
      if (result.failed.length === 0) {
        toast.success(
          t('toast.students.excelImportSuccess').replace('{0}', String(result.imported)),
        )
      } else {
        toast.warning(
          t('toast.students.excelImportPartial')
            .replace('{0}', String(result.imported))
            .replace('{1}', String(result.failed.length)),
        )
      }
      if (result.imported > 0) loadStudents()
    } catch (err) {
      console.error('[Students] Excel import failed:', err)
      toast.error(t('toast.common.importFailed'))
      setExcelImport((prev) => ({ ...prev, importing: false }))
    } finally {
      unsubscribe()
    }
  }

  // 关闭 Excel 导入对话框（导入进行中禁止关闭，防止丢失进度反馈）
  const handleCloseExcelImport = () => {
    if (excelImport.importing) return
    setExcelImport({ open: false, preview: null, importing: false, progress: null, result: null })
  }

  // 下载 Excel 导入模板（走已有 sys:save-dialog → 主进程 xlsx 动态构造）
  const handleDownloadExcelTemplate = async () => {
    try {
      const result = (await getAPI().sys.saveDialog({
        title: t('page.students.import.excel.templateTitle', '保存导入模板'),
        defaultPath: 'students-import-template.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })) as SaveDialogResult
      if (!result || result.canceled || !result.filePath) return
      const r = await getAPI().students.importTemplate(result.filePath)
      if (r.success) {
        toast.success(t('page.students.import.excel.templateSaved'))
      } else {
        toast.error(
          `${t('page.students.import.excel.templateFailed')}: ${r.error ?? t('error.unknown')}`,
        )
      }
    } catch (err) {
      console.error('[Students] Excel template download failed:', err)
      toast.error(t('page.students.import.excel.templateFailed'))
    }
  }

  // 导出排名
  const handleExport = async (format: string) => {
    try {
      const ext = format === 'markdown' ? 'md' : format
      const result = (await getAPI().sys.saveDialog({
        title: t('page.students.export.rankTitle', '导出排名'),
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

  return {
    handleAddStudent,
    handleDeleteStudent,
    handleBatchAssign,
    handleBatchDelete,
    handleImport,
    handleExport,
    handleImportExcel,
    handleConfirmExcelImport,
    handleCloseExcelImport,
    handleDownloadExcelTemplate,
    confirmState,
    setConfirmState,
    excelImport,
  }
}
