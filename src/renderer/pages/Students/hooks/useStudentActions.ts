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
import { useCallback, useState } from 'react'
import { useConfirmAction } from '../../../hooks/useConfirmAction'
import { useCtxMenuAction } from '../../../hooks/useCtxMenuAction'
import { tr, useT } from '../../../i18n'
import { pickFile, saveAs } from '../../../lib/dialog'
import { errText, getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

/** runFileAction 的调用结果形态(兼容 getErrorMessage 的 data/stderr 输入) */
type FileActionResult = { success: boolean; error?: string; data?: unknown; stderr?: string }

/** Excel 导入对话框状态（M30：解析预览 → 确认导入 → 结果/失败清单） */
interface ExcelImportState {
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
  // 自定义确认对话框（替代 window.confirm;状态机统一走 useConfirmAction）
  const { state: confirmState, setState: setConfirmState, ask } = useConfirmAction()
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
      ask(`${t('common.delete')}: "${name}"?`, async () => {
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
      })
    },
    [
      t,
      selectedStudent,
      loadStudents,
      setActionMessageAuto,
      setSelectedStudent,
      ask,
      setConfirmState,
    ],
  )

  // 右键菜单事件处理: 响应 ContextMenu 组件派发的 ctx-menu-action
  // (useCtxMenuAction 渲染期 ref 同步,students 等依赖变化无需重绑监听器)
  useCtxMenuAction('data-ctx-student-name', (action, name) => {
    const student = students.find((s) => s.name === name)
    if (!student) return
    if (action === 'view') {
      setSelectedStudent(student)
    } else if (action === 'delete') {
      handleDeleteStudent(name)
    }
  })

  // 批量调班：将选中学生分入指定班级
  const handleBatchAssign = () => {
    const names = Array.from(selectedNames)
    if (names.length === 0 || !batchAssignTarget) return
    const targetClass = classList.find((c) => c.class_id === batchAssignTarget)
    ask(
      tr(
        'page.students.batch.assignConfirm',
        { 0: String(names.length), 1: targetClass?.name ?? batchAssignTarget },
        '确认将选中的 {0} 名学生调入「{1}」?',
      ),
      async () => {
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
              toast.success(tr('toast.students.batchAssignSuccess', { 0: String(assigned) }))
            } else {
              toast.warning(
                `${tr('page.students.batch.assignPartial', { 0: String(assigned), 1: String(failed.length) }, '调入 {0} 名, 失败 {1} 名')}: ${failed.slice(0, 3).join('; ')}`,
              )
            }
          }
          exitSelectMode()
          await loadStudents()
        } catch (err) {
          toast.error(`${t('toast.students.assignException', '调班异常')}: ${errText(err)}`)
        } finally {
          setBatchAssigning(false)
        }
      },
    )
  }

  // 批量删除选中学生（使用自定义确认对话框，danger 变体）
  const handleBatchDelete = () => {
    const names = Array.from(selectedNames)
    if (names.length === 0) return
    ask(
      tr('page.students.batch.delete.confirm', { 0: String(names.length) }),
      async () => {
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
          tr('page.students.batch.deleted', { 0: String(ok), 1: String(ok + fail) }),
        )
        exitSelectMode()
        await loadStudents()
      },
      { variant: 'danger' },
    )
  }

  /** 文件对话框 → API → toast 的通用骨架(选文件取消时静默返回)。
   *  收敛 导入/模板下载/导出 三个最同构的 handler;Excel 预览/确认导入
   *  有自己的进度订阅与状态机,保持独立实现。 */
  const runFileAction = async (opts: {
    /** console.error 中的动作名(如 'Import') */
    label: string
    dialog: () => Promise<string | null>
    invoke: (filePath: string) => Promise<FileActionResult>
    successKey: string
    failKey: string
    /** 失败详情提取(默认 getErrorMessage;模板下载走 error ?? unknown) */
    detail?: (r: FileActionResult) => string
    /** 成功后刷新学生列表 */
    reload?: boolean
  }): Promise<void> => {
    try {
      const filePath = await opts.dialog()
      if (filePath === null) return
      const r = await opts.invoke(filePath)
      if (r.success) {
        toast.success(t(opts.successKey))
        if (opts.reload) loadStudents()
      } else {
        toast.error(`${t(opts.failKey)}: ${opts.detail ? opts.detail(r) : getErrorMessage(r)}`)
      }
    } catch (err) {
      console.error(`[Students] ${opts.label} failed:`, err)
      toast.error(t(opts.failKey))
    }
  }

  // 批量导入学生
  // main 侧 buildImportArgs 只支持 .json/.jsonl(Rust 端 serde_json 导入),
  // 不再提供 CSV 选项避免用户选中后被拒绝
  const handleImport = () =>
    runFileAction({
      label: 'Import',
      dialog: () =>
        pickFile({
          title: t('page.students.import.dialogTitle', '选择导入文件'),
          filters: [{ name: 'JSON', extensions: ['json', 'jsonl'] }],
          properties: ['openFile'],
        }),
      invoke: (filePath) => getAPI().eaa.import(filePath),
      successKey: 'toast.common.importSuccess',
      failKey: 'toast.common.importFailed',
      reload: true,
    })

  // Excel 批量导入（M30）：选文件 → 主进程 parse-excel → 预览对话框确认
  const handleImportExcel = async () => {
    try {
      const filePath = await pickFile({
        title: t('page.students.import.excel.dialogTitle', '选择 Excel 文件'),
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      })
      if (filePath === null) return
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
        rows: preview.rows.map((r) => ({
          row: r.row,
          name: r.name,
          classId: r.classId,
          alreadyExists: r.alreadyExists,
          studentId: r.studentId,
          idCard: r.idCard,
          gender: r.gender,
          birthDate: r.birthDate,
          phone: r.phone,
          address: r.address,
          email: r.email,
          fatherName: r.fatherName,
          fatherPhone: r.fatherPhone,
          motherName: r.motherName,
          motherPhone: r.motherPhone,
          enrollmentDate: r.enrollmentDate,
          dormNumber: r.dormNumber,
        })),
      })
      if (!result.success) {
        toast.error(`${t('toast.common.importFailed')}: ${result.error ?? t('error.unknown')}`)
        setExcelImport((prev) => ({ ...prev, importing: false }))
        return
      }
      setExcelImport((prev) => ({ ...prev, importing: false, result }))
      if (result.failed.length === 0) {
        toast.success(tr('toast.students.excelImportSuccess', { 0: String(result.imported) }))
      } else {
        toast.warning(
          tr('toast.students.excelImportPartial', {
            0: String(result.imported),
            1: String(result.failed.length),
          }),
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
  const handleDownloadExcelTemplate = () =>
    runFileAction({
      label: 'Excel template download',
      dialog: () =>
        saveAs({
          title: t('page.students.import.excel.templateTitle', '保存导入模板'),
          defaultPath: 'students-import-template.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        }),
      invoke: (filePath) => getAPI().students.importTemplate(filePath),
      successKey: 'page.students.import.excel.templateSaved',
      failKey: 'page.students.import.excel.templateFailed',
      detail: (r) => r.error ?? t('error.unknown'),
    })

  // 导出排名
  const handleExport = (format: string) =>
    runFileAction({
      label: 'Export',
      dialog: () => {
        const ext = format === 'markdown' ? 'md' : format
        return saveAs({
          title: t('page.students.export.rankTitle', '导出排名'),
          defaultPath: `ranking.${ext}`,
          filters: [{ name: format.toUpperCase(), extensions: [ext] }],
        })
      },
      invoke: (filePath) => getAPI().eaa.export(format, filePath),
      successKey: 'toast.common.exportSuccess',
      failKey: 'toast.common.exportFailed',
    })

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
