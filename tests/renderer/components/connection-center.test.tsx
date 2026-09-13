// =============================================================
// 连接中心(2026-09-13) — 面板渲染/动作矩阵/WebUI 状态机/QrCode/Section 锚点揭示
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../src/renderer/stores/toastStore', async () =>
  (await import('../helpers/mock-toast')).mockToastStore,
)

const channelsList = vi.fn()
const channelsStart = vi.fn()
const settingsSet = vi.fn()
const getWebUiStatus = vi.fn()

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    channels: {
      list: (...a: unknown[]) => channelsList(...a),
      start: (...a: unknown[]) => channelsStart(...a),
      onStatusUpdate: () => () => {},
    },
    settings: { set: (...a: unknown[]) => settingsSet(...a) },
    sys: { getWebUiStatus: () => getWebUiStatus() },
  }),
}))

import { ConnectionCenterPanel } from '../../../src/renderer/components/connection-center/ConnectionCenterPanel'
import { QrCode } from '../../../src/renderer/components/connection-center/QrCode'
import { ChannelCard } from '../../../src/renderer/pages/Settings/channels/ChannelCard'
import { Section } from '../../../src/renderer/pages/Settings/components/Section'
import type { ChannelInstanceInfo, WebUiStatus } from '@shared/types'

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

// 测试夹具:URL 中的 k= 为占位串,非真实令牌
const LISTENING_STATUS: WebUiStatus = {
  mode: 'always',
  listening: true,
  protocol: 'https',
  bind: 'lan',
  listenHost: '0.0.0.0',
  ipv6: false,
  port: 18765,
  urls: ['https://192.168.1.5:18765/?k=fixture-value'],
  lanIpv4: ['192.168.1.5'],
  lanIpv6: [],
  inSchedule: true,
  fingerprintSha256: null,
  usingCustomCert: false,
  tokenBits: 256,
  accessToken: '',
  error: null,
}

function renderPanel({
  instances = [],
  webUi,
}: {
  instances?: ChannelInstanceInfo[]
  webUi?: WebUiStatus | null
} = {}) {
  channelsList.mockResolvedValue(instances)
  getWebUiStatus.mockResolvedValue(webUi ?? null)
  const anchor = document.createElement('div')
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <ConnectionCenterPanel
        onClose={vi.fn()}
        anchorRef={{ current: anchor }}
        panelRef={{ current: null }}
      />
    </MemoryRouter>,
  )
  return utils
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

describe('ConnectionCenterPanel', () => {
  beforeEach(() => {
    settingsSet.mockReset().mockResolvedValue({ success: true })
    channelsStart.mockReset().mockResolvedValue({ success: true })
  })
  afterEach(cleanup)

  it('渲染标题/分区/汇总 pill 与频道行', async () => {
    renderPanel({
      instances: [
        mkInstance('feishu', '飞书机器人', 'connected'),
        mkInstance('wecom', '企微机器人', 'disabled'),
      ],
    })
    expect(await screen.findByText('连接中心')).not.toBeNull()
    expect(screen.getByText('消息频道')).not.toBeNull()
    expect(screen.getByText('手机 / 浏览器接入')).not.toBeNull()
    expect(screen.getByText('飞书机器人')).not.toBeNull()
    // 1/2 已连接(部分连接 → 汇总 pill)
    expect(screen.getByText('1/2 已连接')).not.toBeNull()
  })

  it('动作矩阵: connected→断开走 enabled=false(保存即停)', async () => {
    renderPanel({ instances: [mkInstance('feishu', '飞书机器人', 'connected')] })
    const btn = await screen.findByRole('button', { name: '断开' })
    fireEvent.click(btn)
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('channels.feishu.enabled', false))
  })

  it('动作矩阵: disabled→连接走 enabled=true(保存即重连)', async () => {
    renderPanel({ instances: [mkInstance('wecom', '企微机器人', 'disabled')] })
    const btn = await screen.findByRole('button', { name: '连接' })
    fireEvent.click(btn)
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('channels.wecom.enabled', true))
  })

  it('动作矩阵: error→重试直调 channels.start', async () => {
    renderPanel({
      instances: [
        mkInstance('dingtalk', '钉钉机器人', 'error', {
          status: { channel: 'dingtalk', status: 'error', processingCount: 0, pendingCount: 0, detail: 'boom' },
        }),
      ],
    })
    const btn = await screen.findByRole('button', { name: '重试' })
    fireEvent.click(btn)
    await waitFor(() => expect(channelsStart).toHaveBeenCalledWith('dingtalk'))
  })

  it('动作矩阵: not-configured→去配置入口存在(面板不代填表单)', async () => {
    renderPanel({
      instances: [
        mkInstance('wecom', '企微机器人', 'not-configured', { configured: false, enabled: false }),
      ],
    })
    expect(await screen.findByRole('button', { name: '去配置' })).not.toBeNull()
  })

  it('WebUI off 态: 虚线 QR 占位框(§10.3) + 安全提示 + 开启写 webUiMode=always', async () => {
    renderPanel({ webUi: { ...LISTENING_STATUS, mode: 'off', listening: false, urls: [] } })
    expect(await screen.findByText('未开启')).not.toBeNull()
    // 与 listening 同构的取景框占位(开启后原位替换为真 QR,无布局跳变)
    expect(document.querySelector('[data-testid="qr-placeholder"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="qr-frame"]')).toBeNull()
    expect(
      screen.getByText('开启后，局域网内持有链接的人可访问本应用'),
    ).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开启并生成二维码' }))
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('general.webUiMode', 'always'))
  })

  it('WebUI listening 态: 取景框真 QR(§10.2) + 地址 + 关闭入口', async () => {
    renderPanel({ webUi: LISTENING_STATUS })
    expect(await screen.findByText('监听中')).not.toBeNull()
    expect(document.querySelector('[data-testid="qr-frame"]')).not.toBeNull()
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="connection-center-panel"] svg'),
      ).not.toBeNull()
    })
    expect(screen.getByText(/192\.168\.1\.5:18765/)).not.toBeNull()
    expect(screen.getByRole('button', { name: '关闭 WebUI' })).not.toBeNull()
  })

  it('WebUI scheduled 且不在时段: 只读提示,无快捷开启', async () => {
    renderPanel({
      webUi: { ...LISTENING_STATUS, mode: 'scheduled', inSchedule: false, listening: false, urls: [] },
    })
    expect(await screen.findByText('当前不在定时开启时段')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '开启并生成二维码' })).toBeNull()
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
