// =============================================================
// useClassForm — 班级新建/编辑表单 hook 测试
// 覆盖: openCreate/openEdit/closeForm / applyTemplate 模板预填 /
//       编号自动生成与手动覆盖 / handleSave 新建+编辑各分支
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassEntity } from '@shared/types'
import { useClassForm } from '../../../../src/renderer/pages/Classes/hooks/useClassForm'

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
  create: vi.fn(),
  update: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    class: { create: apiMocks.create, update: apiMocks.update },
  }
}

// ---------- 测试数据 ----------

const classes: ClassEntity[] = [
  {
    id: '1',
    class_id: 'G7-1',
    name: '七年级1班',
    grade: '七年级',
    note: '重点班',
    teacher: '张老师',
    archived: false,
    created_at: 0,
  },
  {
    id: '2',
    class_id: 'G7-2',
    name: '七年级2班',
    grade: '七年级',
    note: '',
    teacher: '李老师',
    archived: false,
    created_at: 0,
  },
]

function setup() {
  const reload = vi.fn().mockResolvedValue(undefined)
  const utils = renderHook(() => useClassForm(classes, reload))
  return { ...utils, reload }
}

describe('useClassForm — 表单开关', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('初始: 表单关闭, 空表单, 自动编号开启', () => {
    const { result } = setup()
    expect(result.current.formOpen).toBe(false)
    expect(result.current.editingId).toBeNull()
    expect(result.current.form).toEqual({
      class_id: '',
      name: '',
      grade: '',
      note: '',
      teacher: '',
    })
    expect(result.current.autoClassId).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it('openCreate: 打开空白表单并重置模板/自动编号', () => {
    const { result } = setup()
    act(() => {
      result.current.openEdit(classes[0])
    })
    act(() => {
      result.current.openCreate()
    })
    expect(result.current.formOpen).toBe(true)
    expect(result.current.editingId).toBeNull()
    expect(result.current.form.class_id).toBe('')
    expect(result.current.templateId).toBe('')
    expect(result.current.autoClassId).toBe(true)
  })

  it('openEdit: 预填班级字段并关闭自动编号', () => {
    const { result } = setup()
    act(() => {
      result.current.openEdit(classes[0])
    })
    expect(result.current.formOpen).toBe(true)
    expect(result.current.editingId).toBe('1')
    expect(result.current.form).toEqual({
      class_id: 'G7-1',
      name: '七年级1班',
      grade: '七年级',
      note: '重点班',
      teacher: '张老师',
    })
    expect(result.current.autoClassId).toBe(false)
  })

  it('closeForm: 关闭表单并清空编辑态/模板', () => {
    const { result } = setup()
    act(() => {
      result.current.openEdit(classes[0])
    })
    act(() => {
      result.current.closeForm()
    })
    expect(result.current.formOpen).toBe(false)
    expect(result.current.editingId).toBeNull()
    expect(result.current.templateId).toBe('')
  })
})

describe('useClassForm — applyTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('选择模板: 预填 name/grade/note/teacher(编号需另起)', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.applyTemplate('G7-1')
    })
    expect(result.current.templateId).toBe('G7-1')
    expect(result.current.form.name).toBe('七年级1班')
    expect(result.current.form.grade).toBe('七年级')
    expect(result.current.form.note).toBe('重点班')
    expect(result.current.form.teacher).toBe('张老师')
    // class_id 保持为空, 需用户另起保证唯一
    expect(result.current.form.class_id).toBe('')
  })

  it('传空模板 id: 只清除模板不改动表单', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.applyTemplate('')
    })
    expect(result.current.templateId).toBe('')
    expect(result.current.form.name).toBe('')
  })

  it('未知模板 id: 不改动表单', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.applyTemplate('G-NotExist')
    })
    expect(result.current.templateId).toBe('G-NotExist')
    expect(result.current.form.name).toBe('')
  })
})

describe('useClassForm — 编号自动生成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('年级+班号可识别时: 自动生成 G7-3 形式编号', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onGradeChange('七年级')
    })
    act(() => {
      result.current.onNameChange('3班')
    })
    expect(result.current.form.grade).toBe('七年级')
    expect(result.current.form.name).toBe('3班')
    expect(result.current.form.class_id).toBe('G7-3')
  })

  it('先改名后改年级同样触发重算', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onNameChange('5班')
    })
    act(() => {
      result.current.onGradeChange('八年级')
    })
    expect(result.current.form.class_id).toBe('G8-5')
  })

  it('用户手改编号后: 关闭自动生成, 后续改名不再覆盖', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onGradeChange('七年级')
    })
    act(() => {
      result.current.onNameChange('3班')
    })
    act(() => {
      result.current.onClassIdChange('CUSTOM-1')
    })
    expect(result.current.autoClassId).toBe(false)
    act(() => {
      result.current.onNameChange('9班')
    })
    expect(result.current.form.class_id).toBe('CUSTOM-1')
    expect(result.current.form.name).toBe('9班')
  })

  it('无法识别的年级/班号: 不生成编号', () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onGradeChange('高一')
    })
    act(() => {
      result.current.onNameChange('无数字班')
    })
    expect(result.current.form.class_id).toBe('')
  })
})

describe('useClassForm — handleSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('编号或名称为空: 提示校验失败且不调用 API', async () => {
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    // 仅填名称, 不填编号
    act(() => {
      result.current.onClassIdChange('   ')
      result.current.onNameChange('3班')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(apiMocks.create).not.toHaveBeenCalled()
    expect(result.current.formOpen).toBe(true)
  })

  it('新建成功: 调用 class.create, 关闭表单并 reload', async () => {
    apiMocks.create.mockResolvedValue({ success: true, data: classes[0] })
    const { result, reload } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onClassIdChange('G7-3')
      result.current.onNameChange('七年级3班')
      result.current.setForm((f) => ({ ...f, grade: '七年级', teacher: '王老师' }))
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(apiMocks.create).toHaveBeenCalledWith({
      class_id: 'G7-3',
      name: '七年级3班',
      grade: '七年级',
      note: undefined,
      teacher: '王老师',
    })
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
    expect(result.current.formOpen).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.saving).toBe(false)
  })

  it('新建失败: 透出错误且表单保持打开', async () => {
    apiMocks.create.mockResolvedValue({ success: false, error: '编号重复' })
    const { result, reload } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onClassIdChange('G7-1')
      result.current.onNameChange('七年级1班')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(toastMocks.error.mock.calls[0][0]).toContain('编号重复')
    expect(result.current.formOpen).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('编辑成功: class.update 不含 class_id, 空字段归一为 null', async () => {
    apiMocks.update.mockResolvedValue({ success: true })
    const { result, reload } = setup()
    act(() => {
      result.current.openEdit(classes[1])
    })
    act(() => {
      result.current.setForm((f) => ({ ...f, note: '', teacher: '新老师' }))
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(apiMocks.update).toHaveBeenCalledWith('2', {
      name: '七年级2班',
      grade: '七年级',
      note: null,
      teacher: '新老师',
    })
    expect(apiMocks.create).not.toHaveBeenCalled()
    expect(result.current.formOpen).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('编辑失败: error toast 且表单保持打开', async () => {
    apiMocks.update.mockResolvedValue({ success: false, error: 'db busy' })
    const { result, reload } = setup()
    act(() => {
      result.current.openEdit(classes[0])
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(result.current.formOpen).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('保存抛错: error toast 且 saving 复位', async () => {
    apiMocks.create.mockRejectedValue(new Error('ipc down'))
    const { result } = setup()
    act(() => {
      result.current.openCreate()
    })
    act(() => {
      result.current.onClassIdChange('G7-9')
      result.current.onNameChange('七年级9班')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    expect(result.current.saving).toBe(false)
  })
})