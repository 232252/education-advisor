// =============================================================
// useStudentActions — 学生动作域 hook 测试
// 覆盖: 添加/删除/批量调班/批量删除/导入/导出 各分支 +
//       confirmState 确认框 + ctx-menu-action 右键菜单事件
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassEntity, EAAStudent } from '@shared/types'
import { useStudentActions } from '../../../../src/renderer/pages/Students/hooks/useStudentActions'

// ---------- toast mock ----------

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning,
    info: toastMocks.info,
    show: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}))

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  addStudent: vi.fn(),
  deleteStudent: vi.fn(),
  importFile: vi.fn(),
  exportFile: vi.fn(),
  classAssign: vi.fn(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    eaa: {
      addStudent: apiMocks.addStudent,
      deleteStudent: apiMocks.deleteStudent,
      import: apiMocks.importFile,
      export: apiMocks.exportFile,
    },
    class: { assign: apiMocks.classAssign },
    sys: { openDialog: apiMocks.openDialog, saveDialog: apiMocks.saveDialog },
  }
}

// ---------- 测试数据 ----------

function makeStudent(name: string): EAAStudent {
  return {
    name,
    entity_id: `e-${name}`,
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
  }
}

const students = [makeStudent('甲'), makeStudent('乙'), makeStudent('丙')]

const classList: ClassEntity[] = [
  {
    id: '1',
    class_id: 'G7-1',
    name: '七年级1班',
    archived: false,
    created_at: 0,
  },
]

type Options = Parameters<typeof useStudentActions>[0]

function createOptions(overrides: Partial<Options> = {}): Options {
  return {
    students,
    classList,
    selectedStudent: null,
    setSelectedStudent: vi.fn(),
    selectedNames: new Set(['甲', '乙']),
    batchAssignTarget: 'G7-1',
    setBatchAssigning: vi.fn(),
    setBatchDeleting: vi.fn(),
    exitSelectMode: vi.fn(),
    loadStudents: vi.fn().mockResolvedValue(undefined),
    setActionMessageAuto: vi.fn(),
    setAddingStudent: vi.fn(),
    newStudentName: '',
    newStudentClassId: '',
    setNewStudentName: vi.fn(),
    setNewStudentClassId: vi.fn(),
    ...overrides,
  }
}

function setup(overrides: Partial<Options> = {}) {
  const options = createOptions(overrides)
  return { ...renderHook(() => useStudentActions(options)), options }
}

function ctxEvent(action: string, studentName: string | null) {
  const target = document.createElement('div')
  if (studentName) target.setAttribute('data-ctx-student-name', studentName)
  document.dispatchEvent(
    new CustomEvent('ctx-menu-action', { detail: { action, target } }),
  )
}

describe('useStudentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  // ---------- handleAddStudent ----------

  describe('handleAddStudent', () => {
    it('名称为空: 不调用任何 API', async () => {
      const { result, options } = setup({ newStudentName: '   ' })
      await act(async () => {
        await result.current.handleAddStudent()
      })
      expect(apiMocks.addStudent).not.toHaveBeenCalled()
      expect(options.setActionMessageAuto).not.toHaveBeenCalled()
    })

    it('未选班级: 提示先选班级且不添加', async () => {
      const { result, options } = setup({ newStudentName: '小明', newStudentClassId: '' })
      await act(async () => {
        await result.current.handleAddStudent()
      })
      expect(apiMocks.addStudent).not.toHaveBeenCalled()
      expect(options.setActionMessageAuto).toHaveBeenCalledWith('请先选择班级')
    })

    it('成功: addStudent + class.assign 串行, 重置表单并刷新', async () => {
      apiMocks.addStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      apiMocks.classAssign.mockResolvedValue({ success: true, assigned: 1, failed: [] })
      const { result, options } = setup({ newStudentName: ' 小明 ', newStudentClassId: 'G7-1' })

      await act(async () => {
        await result.current.handleAddStudent()
      })

      expect(apiMocks.addStudent).toHaveBeenCalledWith('小明')
      expect(apiMocks.classAssign).toHaveBeenCalledWith({
        class_id: 'G7-1',
        student_names: ['小明'],
      })
      // 成功消息包含学生名
      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('小明')
      expect(options.setNewStudentName).toHaveBeenCalledWith('')
      expect(options.setNewStudentClassId).toHaveBeenCalledWith('')
      expect(options.setAddingStudent).toHaveBeenCalledWith(false)
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
    })

    it('分配班级失败不阻塞成功提示', async () => {
      apiMocks.addStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      apiMocks.classAssign.mockRejectedValue(new Error('assign failed'))
      const { result, options } = setup({ newStudentName: '小明', newStudentClassId: 'G7-1' })

      await act(async () => {
        await result.current.handleAddStudent()
      })

      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('小明')
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
    })

    it('addStudent 失败: 消息透出 stderr', async () => {
      apiMocks.addStudent.mockResolvedValue({
        success: false,
        data: null,
        stderr: 'duplicated name',
        exitCode: 1,
      })
      const { result, options } = setup({ newStudentName: '小明', newStudentClassId: 'G7-1' })

      await act(async () => {
        await result.current.handleAddStudent()
      })

      expect(apiMocks.classAssign).not.toHaveBeenCalled()
      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('duplicated name')
    })

    it('addStudent 抛错: 提示操作失败', async () => {
      apiMocks.addStudent.mockRejectedValue(new Error('ipc down'))
      const { result, options } = setup({ newStudentName: '小明', newStudentClassId: 'G7-1' })

      await act(async () => {
        await result.current.handleAddStudent()
      })

      expect(options.setActionMessageAuto).toHaveBeenCalledTimes(1)
      expect(options.loadStudents).not.toHaveBeenCalled()
    })
  })

  // ---------- handleDeleteStudent ----------

  describe('handleDeleteStudent', () => {
    it('打开确认框: message 含姓名, 尚未调用删除 API', () => {
      const { result } = setup()
      act(() => {
        result.current.handleDeleteStudent('甲')
      })
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.message).toContain('甲')
      expect(apiMocks.deleteStudent).not.toHaveBeenCalled()
    })

    it('确认后删除成功: 刷新列表并关闭确认框', async () => {
      apiMocks.deleteStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const { result, options } = setup()

      act(() => {
        result.current.handleDeleteStudent('甲')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(apiMocks.deleteStudent).toHaveBeenCalledWith('甲', '管理员操作')
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
      expect(result.current.confirmState.open).toBe(false)
    })

    it('删除当前选中学生: 联动清空选中', async () => {
      apiMocks.deleteStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const selected = students[0]
      const { result, options } = setup({ selectedStudent: selected })

      act(() => {
        result.current.handleDeleteStudent('甲')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(options.setSelectedStudent).toHaveBeenCalledWith(null)
    })

    it('删除失败: 不刷新列表, 消息透出 stderr', async () => {
      apiMocks.deleteStudent.mockResolvedValue({
        success: false,
        data: null,
        stderr: 'not found',
        exitCode: 1,
      })
      const { result, options } = setup()

      act(() => {
        result.current.handleDeleteStudent('甲')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(options.loadStudents).not.toHaveBeenCalled()
      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('not found')
    })

    it('删除抛错: 提示删除失败', async () => {
      apiMocks.deleteStudent.mockRejectedValue(new Error('boom'))
      const { result, options } = setup()

      act(() => {
        result.current.handleDeleteStudent('甲')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(options.setActionMessageAuto).toHaveBeenCalledTimes(1)
      expect(options.loadStudents).not.toHaveBeenCalled()
    })
  })

  // ---------- ctx-menu-action 事件 ----------

  describe('ctx-menu-action 事件监听', () => {
    it('view 动作: 选中对应学生', () => {
      const { result, options } = setup()
      act(() => {
        ctxEvent('view', '甲')
      })
      expect(options.setSelectedStudent).toHaveBeenCalledWith(students[0])
    })

    it('delete 动作: 打开删除确认框', () => {
      const { result } = setup()
      act(() => {
        ctxEvent('delete', '甲')
      })
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.message).toContain('甲')
    })

    it('元素缺少 data-ctx-student-name: 忽略', () => {
      const { result, options } = setup()
      act(() => {
        ctxEvent('view', null)
      })
      expect(options.setSelectedStudent).not.toHaveBeenCalled()
      expect(result.current.confirmState.open).toBe(false)
    })

    it('姓名不在学生列表中: 忽略', () => {
      const { result, options } = setup()
      act(() => {
        ctxEvent('view', '不存在的人')
      })
      expect(options.setSelectedStudent).not.toHaveBeenCalled()
      expect(result.current.confirmState.open).toBe(false)
    })

    it('卸载后移除监听', () => {
      const { result, options, unmount } = setup()
      unmount()
      act(() => {
        ctxEvent('view', '甲')
      })
      expect(options.setSelectedStudent).not.toHaveBeenCalled()
    })
  })

  // ---------- handleBatchAssign ----------

  describe('handleBatchAssign', () => {
    it('未选学生或未选目标班: 不打开确认框', () => {
      const { result } = setup({ selectedNames: new Set() })
      act(() => {
        result.current.handleBatchAssign()
      })
      expect(result.current.confirmState.open).toBe(false)

      const { result: r2 } = setup({ batchAssignTarget: '' })
      act(() => {
        r2.current.handleBatchAssign()
      })
      expect(r2.current.confirmState.open).toBe(false)
    })

    it('确认消息含人数与目标班级名', () => {
      const { result } = setup()
      act(() => {
        result.current.handleBatchAssign()
      })
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.message).toContain('2')
      expect(result.current.confirmState.message).toContain('七年级1班')
    })

    it('确认后全部调入成功: success toast + 退出选择 + 刷新', async () => {
      apiMocks.classAssign.mockResolvedValue({ success: true, assigned: 2, failed: [] })
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchAssign()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(apiMocks.classAssign).toHaveBeenCalledWith({
        class_id: 'G7-1',
        student_names: ['甲', '乙'],
      })
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(toastMocks.success.mock.calls[0][0]).toContain('2')
      expect(options.exitSelectMode).toHaveBeenCalledTimes(1)
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
      expect(options.setBatchAssigning).toHaveBeenCalledWith(true)
      expect(options.setBatchAssigning).toHaveBeenLastCalledWith(false)
    })

    it('部分失败: warning toast 显示成功/失败数', async () => {
      apiMocks.classAssign.mockResolvedValue({ success: true, assigned: 1, failed: ['乙'] })
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchAssign()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(toastMocks.warning).toHaveBeenCalledTimes(1)
      expect(toastMocks.warning.mock.calls[0][0]).toContain('乙')
      expect(options.exitSelectMode).toHaveBeenCalledTimes(1)
    })

    it('res.success=false: error toast 含错误信息', async () => {
      apiMocks.classAssign.mockResolvedValue({ success: false, error: '班级不存在' })
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchAssign()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(toastMocks.error.mock.calls[0][0]).toContain('班级不存在')
      expect(options.exitSelectMode).toHaveBeenCalledTimes(1)
    })

    it('assign 抛错: error toast 含异常信息, 仍复位 batchAssigning', async () => {
      apiMocks.classAssign.mockRejectedValue(new Error('queue busy'))
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchAssign()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(toastMocks.error.mock.calls[0][0]).toContain('queue busy')
      expect(options.setBatchAssigning).toHaveBeenLastCalledWith(false)
    })
  })

  // ---------- handleBatchDelete ----------

  describe('handleBatchDelete', () => {
    it('未选学生: 不打开确认框', () => {
      const { result } = setup({ selectedNames: new Set() })
      act(() => {
        result.current.handleBatchDelete()
      })
      expect(result.current.confirmState.open).toBe(false)
    })

    it('确认框为 danger 变体且消息含人数', () => {
      const { result } = setup()
      act(() => {
        result.current.handleBatchDelete()
      })
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.variant).toBe('danger')
      expect(result.current.confirmState.message).toContain('2')
    })

    it('确认后串行删除: 全部成功', async () => {
      apiMocks.deleteStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchDelete()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(apiMocks.deleteStudent).toHaveBeenCalledTimes(2)
      expect(apiMocks.deleteStudent).toHaveBeenNthCalledWith(1, '甲', '管理员批量操作')
      expect(apiMocks.deleteStudent).toHaveBeenNthCalledWith(2, '乙', '管理员批量操作')
      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('2/2')
      expect(options.exitSelectMode).toHaveBeenCalledTimes(1)
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
      expect(options.setBatchDeleting).toHaveBeenLastCalledWith(false)
    })

    it('部分失败: 消息显示 成功/总数', async () => {
      apiMocks.deleteStudent
        .mockResolvedValueOnce({ success: true, data: '', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ success: false, data: null, stderr: 'deny', exitCode: 1 })
      const { result, options } = setup()

      act(() => {
        result.current.handleBatchDelete()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(options.setActionMessageAuto.mock.calls[0][0]).toContain('1/2')
      expect(options.exitSelectMode).toHaveBeenCalledTimes(1)
    })

    it('删除项中包含当前选中学生: 联动清空', async () => {
      apiMocks.deleteStudent.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const { result, options } = setup({ selectedStudent: students[1] })

      act(() => {
        result.current.handleBatchDelete()
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(options.setSelectedStudent).toHaveBeenCalledWith(null)
    })
  })

  // ---------- handleImport ----------

  describe('handleImport', () => {
    it('取消对话框: 不触发导入', async () => {
      apiMocks.openDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const { result, options } = setup()

      await act(async () => {
        await result.current.handleImport()
      })

      expect(apiMocks.importFile).not.toHaveBeenCalled()
      expect(toastMocks.success).not.toHaveBeenCalled()
      expect(options.loadStudents).not.toHaveBeenCalled()
    })

    it('导入成功: success toast + 刷新', async () => {
      apiMocks.openDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\in.json'] })
      apiMocks.importFile.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const { result, options } = setup()

      await act(async () => {
        await result.current.handleImport()
      })

      expect(apiMocks.importFile).toHaveBeenCalledWith('C:\in.json')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(options.loadStudents).toHaveBeenCalledTimes(1)
    })

    it('导入失败: error toast 含 stderr', async () => {
      apiMocks.openDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\in.json'] })
      apiMocks.importFile.mockResolvedValue({
        success: false,
        data: null,
        stderr: 'bad format',
        exitCode: 1,
      })
      const { result } = setup()

      await act(async () => {
        await result.current.handleImport()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(toastMocks.error.mock.calls[0][0]).toContain('bad format')
    })

    it('openDialog 抛错: error toast', async () => {
      apiMocks.openDialog.mockRejectedValue(new Error('no dialog'))
      const { result } = setup()

      await act(async () => {
        await result.current.handleImport()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })

  // ---------- handleExport ----------

  describe('handleExport', () => {
    it('取消保存对话框: 不触发导出', async () => {
      apiMocks.saveDialog.mockResolvedValue({ canceled: true, filePath: '' })
      const { result } = setup()

      await act(async () => {
        await result.current.handleExport('csv')
      })

      expect(apiMocks.exportFile).not.toHaveBeenCalled()
    })

    it('markdown 格式映射为 .md 扩展名', async () => {
      apiMocks.saveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\rank.md' })
      apiMocks.exportFile.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
      const { result } = setup()

      await act(async () => {
        await result.current.handleExport('markdown')
      })

      expect(apiMocks.saveDialog.mock.calls[0][0].defaultPath).toBe('ranking.md')
      expect(apiMocks.exportFile).toHaveBeenCalledWith('markdown', 'C:\rank.md')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
    })

    it('导出失败: error toast 含 stderr', async () => {
      apiMocks.saveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\rank.csv' })
      apiMocks.exportFile.mockResolvedValue({
        success: false,
        data: null,
        stderr: 'disk full',
        exitCode: 1,
      })
      const { result } = setup()

      await act(async () => {
        await result.current.handleExport('csv')
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(toastMocks.error.mock.calls[0][0]).toContain('disk full')
    })

    it('saveDialog 抛错: error toast', async () => {
      apiMocks.saveDialog.mockRejectedValue(new Error('crash'))
      const { result } = setup()

      await act(async () => {
        await result.current.handleExport('html')
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })
})