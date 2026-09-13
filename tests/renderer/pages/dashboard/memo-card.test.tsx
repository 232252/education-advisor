// =============================================================
// MemoCard — 仪表盘页尾 AI 备忘卡片测试
// 覆盖: 条目渲染(类别徽章/agent 名/时效标注)、按时间倒序、
//       超量收敛("N 条未展示")、空态不渲染、加载失败静默隐藏
// =============================================================

import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoCard } from '../../../../src/renderer/pages/Dashboard/components/MemoCard'

const api = {
  memory: { list: vi.fn() },
  agent: { list: vi.fn() },
}

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => api,
  errText: (e: unknown) => String(e),
}))

// 与 settings-page.test 同款: t 直接回退 fallback 文案,断言用中文默认值
vi.mock('../../../../src/renderer/i18n', () => {
  const t = (key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key
  return { useT: () => ({ t, lang: 'zh' }), tr: t, t, setLang: vi.fn() }
})

const DAY = 24 * 60 * 60 * 1000

function renderCard() {
  return render(
    <MemoryRouter>
      <MemoCard />
    </MemoryRouter>,
  )
}

describe('MemoCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.agent.list.mockResolvedValue([
      { id: 'main', name: '教育参谋' },
      { id: 'academic', name: '学业分析' },
    ])
  })

  it('渲染最近记忆: 类别徽章、agent 名、过时效 task 标注、超量收敛', async () => {
    const now = Date.now()
    api.memory.list.mockResolvedValue([
      {
        agentId: 'main',
        entries: [
          {
            id: 'a1',
            content: '尼克木果请假至 2026-09-15，赴康定考试',
            category: 'task',
            createdAt: now - 60 * 60 * 1000,
          },
          {
            id: 'a2',
            content: '用户是高三5班班主任',
            category: 'user_preference',
            createdAt: now - 20 * DAY,
          },
          {
            id: 'a3',
            content: '旧的进行中任务备忘',
            category: 'task',
            createdAt: now - 20 * DAY,
          },
        ],
      },
      {
        agentId: 'academic',
        entries: [{ id: 'b1', content: '零诊成绩已导入', category: 'fact', createdAt: now - 2 * DAY }],
      },
    ])

    const { container } = renderCard()

    await waitFor(() => expect(screen.getByText('AI 备忘')).toBeTruthy())
    // 4 条全量可见,不应出现收敛脚注
    expect(screen.getByText('尼克木果请假至 2026-09-15，赴康定考试')).toBeTruthy()
    expect(screen.getByText('零诊成绩已导入')).toBeTruthy()
    expect(screen.queryByText(/条未展示/)).not.toBeTruthy()
    // 类别徽章存在(task×2 高亮为"备忘")
    expect(screen.getAllByText('备忘')).toHaveLength(2)
    expect(screen.getByText('事实')).toBeTruthy()
    expect(screen.getByText('偏好')).toBeTruthy()
    // 20 天前的 task 备忘标注过时效;20 天前的偏好不标
    expect(screen.getByText(/已过时效/)).toBeTruthy()
    expect(screen.getAllByText(/已过时效/)).toHaveLength(1)
    // agent 名回显(用列表名而非裸 id)
    expect(screen.getAllByText(/教育参谋/).length).toBeGreaterThan(0)
    expect(screen.getByText(/学业分析/)).toBeTruthy()
    expect(screen.queryByText(/main\b/)).not.toBeTruthy()
    void container
  })

  it('按时间倒序展示,超过 4 条收敛并提示未展示数', async () => {
    const now = Date.now()
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      content: `记忆条目${i}`,
      category: 'fact',
      createdAt: now - i * DAY,
    }))
    api.memory.list.mockResolvedValue([{ agentId: 'main', entries }])

    renderCard()

    await waitFor(() => expect(screen.getByText('记忆条目0')).toBeTruthy())
    // 最新 4 条(条目0~3)可见,最旧的 2 条被收敛
    expect(screen.getByText('记忆条目3')).toBeTruthy()
    expect(screen.queryByText('记忆条目4')).not.toBeTruthy()
    expect(screen.queryByText('记忆条目5')).not.toBeTruthy()
    expect(screen.getByText('2 条未展示 · 设置中可管理')).toBeTruthy()
  })

  it('无任何记忆时不渲染(页面零噪声)', async () => {
    api.memory.list.mockResolvedValue([])
    const { container } = renderCard()
    await waitFor(() => expect(api.memory.list).toHaveBeenCalled())
    // 等 effect 落定后仍无内容
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('memory.list 抛错时静默隐藏,不炸页面', async () => {
    api.memory.list.mockRejectedValue(new Error('ipc down'))
    const { container } = renderCard()
    await waitFor(() => expect(api.memory.list).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('agent.list 失败时回退显示 agentId', async () => {
    api.agent.list.mockRejectedValue(new Error('no agents'))
    api.memory.list.mockResolvedValue([
      {
        agentId: 'main',
        entries: [
          { id: 'x1', content: '某条备忘', category: 'fact', createdAt: Date.now() - 1000 },
        ],
      },
    ])
    renderCard()
    await waitFor(() => expect(screen.getByText('某条备忘')).toBeTruthy())
    expect(screen.getByText(/main/)).toBeTruthy()
  })
})
