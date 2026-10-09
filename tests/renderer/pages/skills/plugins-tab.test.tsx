import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { OPEN_CONNECTION_CENTER } from '../../../../src/renderer/components/connection-center/open-connection-center'

const installState = {
  im: true,
  roster: true,
  grades: false,
  grading: true,
  conduct: true,
}

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    settings: { get: async () => ({ mcp: { enabled: false } }) },
    mcp: { list: async () => ({ success: true, servers: [] }) },
    skill: { list: async () => [] },
    cron: { list: async () => [] },
    channels: {
      list: async () => {
        throw new Error('old channel list')
      },
    },
    ollama: { detect: async () => ({ running: false, models: [] }) },
    grading: { listTasks: async () => ({ success: true, data: [] }) },
    dshIm: {
      pluginInstall: async () => ({ ...installState }),
    },
  }),
}))

import { PluginsTab } from '../../../../src/renderer/pages/Skills/tabs/PluginsTab'

describe('插件中心', () => {
  it('聊天连接打开 IM 插件，不再把飞书画成旧的长连接机器人', async () => {
    const opened = vi.fn()
    window.addEventListener(OPEN_CONNECTION_CENTER, opened)
    render(
      <MemoryRouter>
        <PluginsTab />
      </MemoryRouter>,
    )
    expect(await screen.findByText('聊天连接')).toBeTruthy()
    expect(screen.getByText('花名册')).toBeTruthy()
    expect(screen.getByText('成绩')).toBeTruthy()
    expect(screen.queryByText('飞书长连接机器人,接收消息并触发 Agent')).toBeNull()
    expect(screen.queryByText('未来扩展')).toBeNull()
    expect(screen.queryByText(/能力加载失败/)).toBeNull()
    expect(await screen.findByText('0 个批改任务')).toBeTruthy()
    expect(screen.queryByText('已安装')).toBeNull()
    expect(screen.getAllByText('已接入')).toHaveLength(2)
    expect(screen.getByText('未接入')).toBeTruthy()
    expect(screen.getByText('dsh-im 4.37.0')).toBeTruthy()
    installState.grades = true
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }))
    await waitFor(() => expect(screen.queryByText('未接入')).toBeNull())
    expect(screen.getAllByText('已接入')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    await waitFor(() => expect(opened).toHaveBeenCalled())
    window.removeEventListener(OPEN_CONNECTION_CENTER, opened)
  })
})