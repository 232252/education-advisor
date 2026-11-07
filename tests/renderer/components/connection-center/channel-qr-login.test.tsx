// =============================================================
// ChannelQrLogin — 渠道扫码登录组件行为测试
// 真 render + 假 channels IPC(begin/poll/cancel)+ 假定时器,
// 锁定: begin→pending 轮询、scanned/confirmed/expired/cancelled/
// error 全状态机 UI、confirmed 回调与 toast、取消清理、卸载补偿。
//
// 假时钟下不能用 findBy* / waitFor：这两者靠真实 setTimeout 轮询，
// 会被冻在 30s 超时。异步落地一律用 flush() 冲微任务，时间推进用
// advance() 显式驱动。
// =============================================================

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  beginLogin: vi.fn(),
  pollLogin: vi.fn(),
  cancelLogin: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onConfirmed: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    channels: {
      beginLogin: mocks.beginLogin,
      pollLogin: mocks.pollLogin,
      cancelLogin: mocks.cancelLogin,
    },
  }),
}))
vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock('../../../../src/renderer/components/connection-center/QrCode', () => ({
  QrCode: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}))
// 文案直接走 fallback，避免测试结果依赖当前界面语言。
vi.mock('../../../../src/renderer/i18n', () => ({
  useT: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    lang: 'zh',
  }),
}))

import { ChannelQrLogin } from '../../../../src/renderer/components/connection-center/ChannelQrLogin'

/** 冲掉已 resolve 的 promise 链，让 setState 落地。 */
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

/** 推进假时钟并让期间产生的微任务跑完。 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function setup() {
  return render(<ChannelQrLogin channelId="weixin" onConfirmed={mocks.onConfirmed} />)
}

async function beginPending() {
  mocks.beginLogin.mockResolvedValue({ loginId: 'L1', qrContent: 'https://qr/abc' })
  fireEvent.click(screen.getByText('开始扫码'))
  await flush()
  expect(screen.getByTestId('qr')).toBeTruthy()
}

describe('ChannelQrLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.pollLogin.mockResolvedValue({ status: 'pending', detail: '' })
    // 卸载补偿会 fire-and-forget 地链 .catch()，mock 必须返回 Promise。
    mocks.cancelLogin.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('begin → pending: 展示二维码并按 2s 轮询', async () => {
    setup()
    await beginPending()
    expect(mocks.beginLogin).toHaveBeenCalledWith('weixin')
    expect(screen.getByTestId('qr').dataset.value).toBe('https://qr/abc')

    await advance(2100)
    expect(mocks.pollLogin).toHaveBeenCalledWith('L1')

    await advance(2000)
    expect(mocks.pollLogin).toHaveBeenCalledTimes(2)
  })

  it('scanned: 提示手机确认,继续轮询;confirmed: 停轮询 + toast + onConfirmed', async () => {
    setup()
    await beginPending()
    mocks.pollLogin.mockResolvedValueOnce({ status: 'scanned', detail: '微信已扫码' })
    await advance(2100)
    expect(screen.getByText('微信已扫码')).toBeTruthy()

    mocks.pollLogin.mockResolvedValueOnce({ status: 'confirmed', detail: '绑定成功!' })
    await advance(2000)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('绑定成功!')
    expect(mocks.onConfirmed).toHaveBeenCalledTimes(1)

    // confirmed 后停止轮询
    await advance(6000)
    expect(mocks.pollLogin).toHaveBeenCalledTimes(2)
  })

  it('expired: 停轮询并出重试按钮;点重试重新 begin', async () => {
    setup()
    await beginPending()
    mocks.pollLogin.mockResolvedValueOnce({ status: 'expired', detail: '' })
    await advance(2100)
    expect(screen.getByText('二维码已过期')).toBeTruthy()

    await advance(4000)
    expect(mocks.pollLogin).toHaveBeenCalledTimes(1)

    mocks.beginLogin.mockClear()
    fireEvent.click(screen.getByText('重新扫码'))
    await flush()
    expect(screen.getByTestId('qr')).toBeTruthy()
    expect(mocks.beginLogin).toHaveBeenCalledTimes(1)
  })

  it('cancelled → 回 idle;error → 错误态', async () => {
    setup()
    await beginPending()
    mocks.pollLogin.mockResolvedValueOnce({ status: 'cancelled', detail: '' })
    await advance(2100)
    expect(screen.getByText('开始扫码')).toBeTruthy()

    fireEvent.click(screen.getByText('开始扫码'))
    await flush()
    expect(screen.getByTestId('qr')).toBeTruthy()

    mocks.pollLogin.mockResolvedValueOnce({ status: 'error', detail: '通道炸了' })
    await advance(2100)
    expect(screen.getByText('通道炸了')).toBeTruthy()
    expect(screen.getByText('重新扫码')).toBeTruthy()
  })

  it('poll 抛错: 停轮询进错误态', async () => {
    setup()
    await beginPending()
    mocks.pollLogin.mockRejectedValueOnce(new Error('net down'))
    await advance(2100)
    expect(screen.getByText('Error: net down')).toBeTruthy()

    await advance(4000)
    expect(mocks.pollLogin).toHaveBeenCalledTimes(1)
  })

  it('手动取消: cancelLogin + 回 idle;卸载补偿: unmount 时取消登录', async () => {
    const { unmount } = setup()
    await beginPending()

    fireEvent.click(screen.getByText('取消'))
    await flush()
    expect(mocks.cancelLogin).toHaveBeenCalledWith('L1')
    expect(screen.getByText('开始扫码')).toBeTruthy()

    mocks.beginLogin.mockResolvedValue({ loginId: 'L2', qrContent: 'https://qr/x' })
    fireEvent.click(screen.getByText('开始扫码'))
    await flush()
    expect(screen.getByTestId('qr').dataset.value).toBe('https://qr/x')

    unmount()
    await flush()
    expect(mocks.cancelLogin).toHaveBeenLastCalledWith('L2')
  })

  it('begin 失败: toast.error + 错误态', async () => {
    setup()
    mocks.beginLogin.mockRejectedValue(new Error('no channel'))
    fireEvent.click(screen.getByText('开始扫码'))
    await flush()
    expect(mocks.toastError).toHaveBeenCalledWith('Error: no channel')
    expect(screen.getByText('重新扫码')).toBeTruthy()
  })
})
