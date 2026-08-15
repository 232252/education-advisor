// =============================================================
// useStudentActions — 学生动作域 hook
// 封装 添加/删除/批量调班/批量删除/导入/导出 六个 handler,
// confirmState 确认对话框管理,以及右键菜单 ctx-menu-action 事件监听。
// 依赖通过参数注入,返回所有 handler + confirmState + setConfirmState。
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { ConfirmState, OpenDialogResult, SaveDialogResult } from '../types'

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

  // 导出排名
  const handleExport = async (format: string) => {
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

  return {
    handleAddStudent,
    handleDeleteStudent,
    handleBatchAssign,
    handleBatchDelete,
    handleImport,
    handleExport,
    confirmState,
    setConfirmState,
  }
}
