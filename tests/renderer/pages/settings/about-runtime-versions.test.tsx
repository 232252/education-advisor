// =============================================================
// AboutSection — 底层运行时版本从主进程单一来源读取
//
// dsh / dsh-im / Electron 的版本此前写死在文案里（Electron 43.2 已漂移）。
// 这里验证页面显示 sys.getRuntimeVersions 返回的值，而不是硬编码。
// 约定同 tests/renderer/pages/models/*：mock ipc-client，真实 i18n。
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getVersion = vi.fn()
const getRuntimeVersions = vi.fn()

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    sys: {
      getVersion: (...args: unknown[]) => getVersion(...args),
      getRuntimeVersions: (...args: unknown[]) => getRuntimeVersions(...args),
    },
  }),
}))

import { AboutSection } from '../../../../src/renderer/pages/Settings/sections/AboutSection'

beforeEach(() => {
  getVersion.mockReset()
  getRuntimeVersions.mockReset()
  getVersion.mockResolvedValue('3.3.7-beta.6')
  getRuntimeVersions.mockResolvedValue({
    dsh: '9.9.9-eaa-test',
    dshIm: '5.10.0',
    electron: '45.0.0',
  })
})

afterEach(() => {
  cleanup()
})

describe('AboutSection 运行时版本', () => {
  it('dsh 与 dsh-im 版本显示主进程返回的值，而不是写死的旧版本', async () => {
    render(
      <MemoryRouter>
        <AboutSection />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /关于/ }))
    await waitFor(() => expect(getRuntimeVersions).toHaveBeenCalled())
    expect(await screen.findByText(/dsh 9\.9\.9-eaa-test/)).toBeTruthy()
    expect(screen.getByText(/dsh-im 5\.10\.0/)).toBeTruthy()
    expect(screen.queryByText(/0\.2\.2-rc\.1/)).toBeNull()
  })

  it('Electron 版本显示真实进程版本，不再写死 43.2', async () => {
    render(
      <MemoryRouter>
        <AboutSection />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /关于/ }))
    expect(await screen.findByText(/Electron 45\.0\.0/)).toBeTruthy()
    expect(screen.queryByText(/Electron 43\.2/)).toBeNull()
  })
})