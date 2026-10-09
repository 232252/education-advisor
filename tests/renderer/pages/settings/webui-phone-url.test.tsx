import { cleanup, render, screen } from '@testing-library/react'
import type { UnifiedSettings, WebUiStatus } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const statusBox: { current: WebUiStatus } = {
  current: {
    mode: 'always',
    listening: true,
    protocol: 'https',
    bind: 'lan',
    listenHost: '0.0.0.0',
    ipv6: false,
    port: 18765,
    urls: ['https://127.0.0.1:18765/?k=token', 'https://192.168.1.8:18765/?k=token'],
    lanIpv4: ['https://192.168.1.8:18765/?k=token'],
    lanIpv6: [],
    inSchedule: true,
    fingerprintSha256: null,
    usingCustomCert: false,
    tokenBits: 256,
    accessToken: 'token',
    error: null,
  },
}

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    sys: {
      getWebUiStatus: async () => statusBox.current,
      openWebUi: async () => ({ success: true }),
      regenerateWebUiToken: async () => ({ success: true }),
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { WebUiSection } from '../../../../src/renderer/pages/Settings/sections/WebUiSection'
import { webUiPhoneUrl } from '../../../../src/renderer/pages/Settings/sections/webui-phone-url'

const settings = {
  general: {
    webUiMode: 'always',
    webUiPort: 18765,
    webUiProtocol: 'https',
    webUiBind: 'lan',
    webUiIpv6: true,
    webUiScheduleDays: [1, 2, 3, 4, 5],
    webUiScheduleStart: '08:00',
    webUiScheduleEnd: '22:00',
    webUiTlsCertPath: '',
    webUiTlsKeyPath: '',
  },
} as unknown as UnifiedSettings

describe('webUiPhoneUrl', () => {
  it('只用局域网地址', () => {
    expect(webUiPhoneUrl(statusBox.current)).toBe('https://192.168.1.8:18765/?k=token')
    expect(
      webUiPhoneUrl({ ...statusBox.current, lanIpv4: [], urls: ['https://127.0.0.1:18765/?k=token'] }),
    ).toBeNull()
  })
})

describe('WebUiSection 手机接入', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })
  afterEach(cleanup)

  it('监听局域网时给出二维码，不再把人指到连接中心', async () => {
    render(
      <MemoryRouter initialEntries={['/settings#webui']}>
        <WebUiSection settings={settings} onSave={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('img', { name: 'QR code' })).not.toBeNull()
    expect(screen.getByText(/用手机相机扫这个二维码/)).not.toBeNull()
    expect(screen.queryByText(/Alt\+C/)).toBeNull()
  })

  it('只在本机监听时不画二维码', async () => {
    statusBox.current = {
      ...statusBox.current,
      bind: 'loopback',
      urls: ['https://127.0.0.1:18765/?k=token'],
      lanIpv4: [],
    }
    render(
      <MemoryRouter initialEntries={['/settings#webui']}>
        <WebUiSection settings={settings} onSave={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/请把访问范围改成局域网/)).not.toBeNull()
    expect(screen.queryByRole('img', { name: 'QR code' })).toBeNull()
  })
})
