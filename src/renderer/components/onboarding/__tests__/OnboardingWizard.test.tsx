// =============================================================
// OnboardingWizard — 首次使用引导向导测试
// 验证: 触发检测(无标记+无班级)/欢迎页/建班/学生/Agent/完成/跳过标记
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

import { useToastStore } from '../../../stores/toastStore'
import { ToastContainer } from '../../ToastContainer'
import { OnboardingWizard } from '../OnboardingWizard'

const DONE_KEY = 'ea.onboarding.done'

const classListMock = vi.fn()
const classCreateMock = vi.fn()
const classAssignMock = vi.fn()
const addStudentMock = vi.fn()
const agentListMock = vi.fn()
const agentToggleMock = vi.fn()

function setupApi(overrides?: Record<string, unknown>) {
  ;(window as unknown as { api: unknown }).api = {
    class: {
      list: classListMock,
      create: classCreateMock,
      assign: classAssignMock,
    },
    eaa: { addStudent: addStudentMock },
    agent: { list: agentListMock, toggle: agentToggleMock },
    ...overrides,
  }
}

function renderWizard() {
  return render(
    <MemoryRouter>
      <OnboardingWizard />
      <ToastContainer />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useToastStore.getState().clear()
  navigate.mockReset()
  classListMock.mockResolvedValue({ success: true, data: [] })
  classCreateMock.mockResolvedValue({ success: true, data: {} })
  classAssignMock.mockResolvedValue({ success: true, assigned: 1 })
  addStudentMock.mockResolvedValue({ success: true, data: 'ok', stderr: '', exitCode: 0 })
  agentListMock.mockResolvedValue([])
  agentToggleMock.mockResolvedValue({ success: true })
  setupApi()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('OnboardingWizard — 触发检测', () => {
  it('无标记且无班级 → 显示欢迎页', async () => {
    renderWizard()
    await waitFor(() => {
      expect(screen.getByText('欢迎使用 Education Advisor')).toBeDefined()
    })
  })

  it('已有完成标记 → 不渲染', async () => {
    localStorage.setItem(DONE_KEY, '1')
    const { container } = renderWizard()
    // 等待检测周期过去(无任何内容渲染)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.innerHTML).toBe('')
  })

  it('已有班级(老用户) → 静默标记并关闭', async () => {
    classListMock.mockResolvedValue({
      success: true,
      data: [{ id: 'c1', class_id: 'G7-3', name: '七年级3班' }],
    })
    const { container } = renderWizard()
    await waitFor(() => {
      expect(localStorage.getItem(DONE_KEY)).toBe('1')
    })
    expect(container.innerHTML).toBe('')
  })

  it('class.list 抛错 → 不显示向导(容错)', async () => {
    classListMock.mockRejectedValue(new Error('ipc down'))
    const { container } = renderWizard()
    await new Promise((r) => setTimeout(r, 50))
    expect(container.innerHTML).toBe('')
    expect(localStorage.getItem(DONE_KEY)).toBeNull()
  })

  it('class.list 返回失败 → 不显示向导且不标记', async () => {
    classListMock.mockResolvedValue({ success: false, data: [], error: 'db locked' })
    const { container } = renderWizard()
    await new Promise((r) => setTimeout(r, 50))
    expect(container.innerHTML).toBe('')
    expect(localStorage.getItem(DONE_KEY)).toBeNull()
  })
})

describe('OnboardingWizard — 建班步骤', () => {
  async function openClassStep() {
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.click(screen.getByText('开始配置'))
    await waitFor(() => screen.getByText('创建你的第一个班级'))
  }

  it('欢迎页 → 开始配置 → 建班表单,默认自动编号预览', async () => {
    await openClassStep()
    // 默认 七年级 + 1班 → G7-1
    expect(screen.getByText(/将使用编号: G7-1/)).toBeDefined()
  })

  it('创建成功 → class.create 带正确参数 → 进入学生步骤', async () => {
    await openClassStep()
    fireEvent.click(screen.getByText('创建班级并继续'))
    await waitFor(() => {
      expect(classCreateMock).toHaveBeenCalledWith({
        class_id: 'G7-1',
        name: '1班',
        grade: '七年级',
        teacher: undefined,
      })
    })
    await waitFor(() => {
      expect(screen.getByText('添加学生名单')).toBeDefined()
    })
  })

  it('创建失败 → 停留在建班步骤', async () => {
    classCreateMock.mockResolvedValue({ success: false, error: '编号重复' })
    await openClassStep()
    fireEvent.click(screen.getByText('创建班级并继续'))
    await waitFor(() => {
      expect(screen.getByText('编号重复')).toBeDefined()
    })
    expect(screen.queryByText('添加学生名单')).toBeNull()
  })

  it('手动填写编号覆盖自动生成', async () => {
    await openClassStep()
    fireEvent.change(screen.getByPlaceholderText('G7-1'), { target: { value: 'CUSTOM-9' } })
    expect(screen.getByText(/将使用编号: CUSTOM-9/)).toBeDefined()
  })
})

describe('OnboardingWizard — 学生步骤', () => {
  async function openStudentsStep() {
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.click(screen.getByText('开始配置'))
    await waitFor(() => screen.getByText('创建班级并继续'))
    fireEvent.click(screen.getByText('创建班级并继续'))
    await waitFor(() => screen.getByText('添加学生名单'))
  }

  it('输入名单 → 实时识别人数', async () => {
    await openStudentsStep()
    const ta = screen.getByPlaceholderText(/张三/)
    fireEvent.change(ta, { target: { value: '张三\n李四\n王五' } })
    expect(screen.getByText('识别到 3 名学生')).toBeDefined()
  })

  it('添加并继续 → 逐个 addStudent + assign → 进入 Agent 步骤', async () => {
    await openStudentsStep()
    fireEvent.change(screen.getByPlaceholderText(/张三/), {
      target: { value: '张三\n李四' },
    })
    fireEvent.click(screen.getByText('添加 2 名学生并继续'))
    await waitFor(() => {
      expect(screen.getByText('启用智能 Agent')).toBeDefined()
    })
    expect(addStudentMock).toHaveBeenCalledTimes(2)
    expect(addStudentMock).toHaveBeenCalledWith('张三')
    expect(addStudentMock).toHaveBeenCalledWith('李四')
    expect(classAssignMock).toHaveBeenCalledWith({
      class_id: 'G7-1',
      student_names: ['张三'],
    })
  })

  it('addStudent 部分失败 → 失败计数,仍进入下一步', async () => {
    addStudentMock.mockImplementation(async (name: string) =>
      name === '李四'
        ? { success: false, data: null, stderr: 'exists', exitCode: 1 }
        : { success: true, data: 'ok', stderr: '', exitCode: 0 },
    )
    await openStudentsStep()
    fireEvent.change(screen.getByPlaceholderText(/张三/), {
      target: { value: '张三\n李四' },
    })
    fireEvent.click(screen.getByText('添加 2 名学生并继续'))
    await waitFor(() => {
      expect(screen.getByText('启用智能 Agent')).toBeDefined()
    })
  })

  it('空名单 → 按钮显示下一步,直接进入 Agent 步骤', async () => {
    await openStudentsStep()
    fireEvent.click(screen.getByText('下一步'))
    await waitFor(() => {
      expect(screen.getByText('启用智能 Agent')).toBeDefined()
    })
    expect(addStudentMock).not.toHaveBeenCalled()
  })

  it('跳过,稍后导入 → 不添加,进入 Agent 步骤', async () => {
    await openStudentsStep()
    fireEvent.change(screen.getByPlaceholderText(/张三/), {
      target: { value: '张三' },
    })
    fireEvent.click(screen.getByText('跳过,稍后导入'))
    await waitFor(() => {
      expect(screen.getByText('启用智能 Agent')).toBeDefined()
    })
    expect(addStudentMock).not.toHaveBeenCalled()
  })
})

describe('OnboardingWizard — Agent 步骤与完成', () => {
  async function openAgentsStep() {
    agentListMock.mockResolvedValue([
      {
        id: 'a1',
        name: '学情分析师',
        description: '分析成绩',
        enabled: false,
        role: '',
        modelTier: 'high_quality',
        schedule: [],
        capabilities: [],
      },
      {
        id: 'a2',
        name: '报告撰写员',
        description: '写报告',
        enabled: false,
        role: '',
        modelTier: 'low_cost',
        schedule: [],
        capabilities: [],
      },
    ])
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.click(screen.getByText('开始配置'))
    await waitFor(() => screen.getByText('创建班级并继续'))
    fireEvent.click(screen.getByText('创建班级并继续'))
    await waitFor(() => screen.getByText('添加学生名单'))
    fireEvent.click(screen.getByText('跳过,稍后导入'))
    await waitFor(() => screen.getByText('启用智能 Agent'))
    await waitFor(() => screen.getByText('学情分析师'))
  }

  it('Agent 列表默认全选', async () => {
    await openAgentsStep()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.checked)).toBe(true)
  })

  it('取消勾选一个 → 只 toggle 勾选的', async () => {
    await openAgentsStep()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByText('完成配置'))
    await waitFor(() => {
      expect(agentToggleMock).toHaveBeenCalledTimes(1)
    })
    expect(agentToggleMock).toHaveBeenCalledWith('a1', true)
  })

  it('完成配置 → 完成页摘要 → 开始使用 → 标记 + 跳转 dashboard', async () => {
    await openAgentsStep()
    fireEvent.click(screen.getByText('完成配置'))
    await waitFor(() => {
      expect(screen.getByText('配置完成!')).toBeDefined()
    })
    // 摘要: 未添加学生 / 已启用 2 个 Agent
    expect(screen.getByText('2 个')).toBeDefined()
    fireEvent.click(screen.getByText('开始使用'))
    expect(localStorage.getItem(DONE_KEY)).toBe('1')
    expect(navigate).toHaveBeenCalledWith('/dashboard')
  })
})

describe('OnboardingWizard — 跳过与关闭', () => {
  it('欢迎页点跳过引导 → 标记完成 + 关闭', async () => {
    renderWizard()
    await waitFor(() => screen.getByText('跳过引导'))
    fireEvent.click(screen.getByText('跳过引导'))
    expect(localStorage.getItem(DONE_KEY)).toBe('1')
  })

  it('建班页点遮罩 → 关闭并标记(非欢迎页允许遮罩关闭)', async () => {
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.click(screen.getByText('开始配置'))
    await waitFor(() => screen.getByText('创建你的第一个班级'))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(localStorage.getItem(DONE_KEY)).toBe('1')
  })

  it('欢迎页点遮罩不关闭(防误触)', async () => {
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(localStorage.getItem(DONE_KEY)).toBeNull()
    expect(screen.getByText('欢迎使用 Education Advisor')).toBeDefined()
  })

  it('建班页按 Escape → 关闭并标记', async () => {
    renderWizard()
    await waitFor(() => screen.getByText('开始配置'))
    fireEvent.click(screen.getByText('开始配置'))
    await waitFor(() => screen.getByText('创建你的第一个班级'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(localStorage.getItem(DONE_KEY)).toBe('1')
  })
})
