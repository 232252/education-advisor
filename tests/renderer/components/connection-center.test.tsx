// =============================================================
// 连接中心(2026-09-13) — 面板渲染/动作矩阵/WebUI 状态机/QrCode/Section 锚点揭示
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../src/renderer/stores/toastStore', async () =>
  (await import('../helpers/mock-toast')).mockToastStore,
)

const dshImShow = vi.fn()
const dshImHide = vi.fn()

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    dshIm: {
      show: (bounds: unknown) => dshImShow(bounds),
      hide: () => dshImHide(),
      onClosed: () => () => {},
    },
    channels: {
      list: async () => [],
      onStatusUpdate: () => () => {},
    },
  }),
}))

import { ConnectionCenter } from '../../../src/renderer/components/connection-center/ConnectionCenter'
import {
  computePanelBox,
  ConnectionCenterPanel,
} from '../../../src/renderer/components/connection-center/ConnectionCenterPanel'
import { requestOpenConnectionCenter } from '../../../src/renderer/components/connection-center/open-connection-center'
import { QrCode } from '../../../src/renderer/components/connection-center/QrCode'
import { ChannelCard } from '../../../src/renderer/pages/Settings/channels/ChannelCard'
import { Section } from '../../../src/renderer/pages/Settings/components/Section'
import type { ChannelInstanceInfo } from '@shared/types'

function mkInstance(
  id: string,
  label: string,
  status: string,
  extra: Record<string, unknown> = {},
): ChannelInstanceInfo {
  return {
    manifest: {
      id,
      label,
      description: `${label} 渠道`,
      icon: id,
      capabilities: {},
      configSchema: [],
    },
    configured: true,
    enabled: true,
    status: {
      channel: id,
      status,
      processingCount: 0,
      pendingCount: 0,
    },
    ...extra,
  } as unknown as ChannelInstanceInfo
}

function renderPanel() {
  const anchor = document.createElement('div')
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ConnectionCenterPanel
        onClose={vi.fn()}
        anchorRef={{ current: anchor }}
        panelRef={{ current: null }}
      />
    </MemoryRouter>,
  )
}

describe('QrCode(uqr 封装)', () => {
  afterEach(cleanup)

  it('渲染白底 SVG 二维码', () => {
    const { container } = render(<QrCode value="https://192.168.1.5:18765/?k=fixture" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelector('rect[fill="white"]')).not.toBeNull()
  })
})

describe('computePanelBox', () => {
  function anchorBesideSidebar(sidebarRight: number): HTMLButtonElement {
    const aside = document.createElement('aside')
    const button = document.createElement('button')
    aside.appendChild(button)
    const box = (right: number) => ({
      x: 0,
      y: 0,
      width: right,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right,
      toJSON() {
        return {}
      },
    })
    aside.getBoundingClientRect = () => box(sidebarRight)
    button.getBoundingClientRect = () => box(sidebarRight)
    return button
  }

  it('侧栏旁边不够官方左右栏时铺满窗口', () => {
    const anchor = anchorBesideSidebar(240)
    const narrow = computePanelBox(anchor, { width: 1024, height: 640 })
    expect(narrow.left).toBe(8)
    expect(narrow.width).toBeGreaterThanOrEqual(860)

    const wide = computePanelBox(anchor, { width: 1400, height: 900 })
    expect(wide.left).toBe(248)
    expect(wide.width).toBe(1144)
    expect(wide.top + wide.height).toBe(892)
  })

  it('窗口比最小尺寸更小时贴住窗口，关闭按钮留在屏幕里', () => {
    const anchor = anchorBesideSidebar(240)
    const box = computePanelBox(anchor, { width: 400, height: 320 })
    expect(box.left).toBe(8)
    expect(box.top).toBe(8)
    expect(box.left + box.width).toBe(392)
    expect(box.top + box.height).toBe(312)
    expect(box.width).toBeLessThan(480)
    expect(box.height).toBeLessThan(420)
  })
})

describe('ConnectionCenterPanel', () => {
  beforeEach(() => {
    dshImShow.mockReset().mockResolvedValue({ ok: true })
    dshImHide.mockReset().mockResolvedValue(undefined)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 40,
      y: 80,
      width: 900,
      height: 640,
      top: 80,
      left: 40,
      bottom: 720,
      right: 940,
      toJSON() {
        return {}
      },
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('按面板区域让主进程贴上 IM 视图，不把登录地址放进页面', async () => {
    renderPanel()
    expect(await screen.findByText('连接中心')).not.toBeNull()
    expect(screen.getByRole('button', { name: '数据同步' })).not.toBeNull()
    expect(screen.queryByText('左侧选择平台完成登录')).toBeNull()
    await waitFor(() => expect(dshImShow).toHaveBeenCalled())
    expect(dshImShow.mock.calls[0][0]).toMatchObject({ x: 40, y: 80, width: 900, height: 640 })
    expect(screen.queryByTitle('dsh-im')).toBeNull()
  })

  it('打开后不再每帧重复贴视图', async () => {
    let rafCalls = 0
    const real = window.requestAnimationFrame.bind(window)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls += 1
      return real(cb as FrameRequestCallback)
    })
    renderPanel()
    await waitFor(() => expect(dshImShow).toHaveBeenCalled())
    const afterOpen = rafCalls
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(rafCalls).toBe(afterOpen)
  })

  it('宿主没起来时显示错误，并可重试', async () => {
    dshImShow.mockResolvedValueOnce({ ok: false, error: 'dsh 还没装好' })
    renderPanel()
    expect(await screen.findByText('dsh 还没装好')).not.toBeNull()
    dshImShow.mockResolvedValueOnce({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(dshImShow).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('dsh 还没装好')).toBeNull()
  })
})

describe('ConnectionCenter', () => {
  beforeEach(() => {
    dshImShow.mockReset().mockResolvedValue({ ok: true })
    dshImHide.mockReset().mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('设置页可以唤起同一块 IM 面板', async () => {
    render(
      <MemoryRouter>
        <ConnectionCenter />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('connection-center-panel')).toBeNull()
    requestOpenConnectionCenter()
    expect(await screen.findByTestId('connection-center-panel')).not.toBeNull()
  })

  it('旧频道报错不会在入口上亮红点', async () => {
    render(
      <MemoryRouter>
        <ConnectionCenter />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status', { name: '错误' })).toBeNull()
    expect(screen.getByRole('button', { name: '连接中心' })).not.toBeNull()
  })
})

describe('ChannelCard 运行时长(§10.6)', () => {
  afterEach(cleanup)

  function renderCard(status: Record<string, unknown>) {
    const info = mkInstance('feishu', '飞书机器人', 'connected', { status })
    return render(
      <ChannelCard info={info} expanded={false} onToggleExpand={() => {}} onSave={() => {}} />,
    )
  }

  it('connected 且有 connectedAt → 显示「已运行 …」', () => {
    renderCard({
      channel: 'feishu',
      status: 'connected',
      processingCount: 0,
      pendingCount: 0,
      connectedAt: Date.now() - (2 * 60 + 5) * 60_000,
    })
    expect(screen.getByText(/已运行 2 小时 5 分/)).not.toBeNull()
  })

  it('无 connectedAt(未连接过) → 不显示时长', () => {
    renderCard({ channel: 'feishu', status: 'connected', processingCount: 0, pendingCount: 0 })
    expect(screen.queryByText(/已运行/)).toBeNull()
  })
})

describe('Section 锚点揭示', () => {
  afterEach(cleanup)

  it('hash 命中 id 时自动展开', () => {
    render(
      <MemoryRouter initialEntries={['/settings#connection']}>
        <Section id="connection" title="连接中心">
          <div>内容</div>
        </Section>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /连接中心/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(screen.getByText('内容')).not.toBeNull()
  })

  it('hash 未命中保持折叠(其余 Section 行为零变化)', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Section id="connection" title="连接中心">
          <div>内容</div>
        </Section>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /连接中心/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.queryByText('内容')).toBeNull()
  })
})
