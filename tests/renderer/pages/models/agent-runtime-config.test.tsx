// =============================================================
// AgentRuntimeConfig — Agent 运行时后端切换(models.agentRuntime)
// + dsh 路由映射(models.dshRoutes)编辑器
// 覆盖: select 回显持久化值 / 选 dsh 经 settings.set 落盘 /
//       映射编辑区仅 runtime==='dsh' 时渲染 / 改·删·增以整对象写回
// 约定同 tests/renderer/pages/settings/*: mock ipc-client + toastStore,
// 使用真实 i18n(默认 zh 字典),断言取字典文案。
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/renderer/stores/toastStore', async () =>
  (await import('../../helpers/mock-toast')).mockToastStore,
)

const settingsGet = vi.fn()
const settingsSet = vi.fn()

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    settings: {
      get: (...args: unknown[]) => settingsGet(...args),
      set: (...args: unknown[]) => settingsSet(...args),
    },
  }),
}))

import { AgentRuntimeConfig } from '../../../../src/renderer/pages/Models/components/AgentRuntimeConfig'

/** 已存 dsh 配置: 运行时 = dsh + 两条路由映射 */
const DSH_SETTINGS = {
  models: { agentRuntime: 'dsh', dshRoutes: { deepseek: 'ds-chat', openai: 'gpt-route' } },
}

/** 挂载并等首帧渲染完成;select() 取运行时下拉(组件内唯一 <select>) */
async function mount(settings: unknown) {
  settingsGet.mockResolvedValue(settings)
  const utils = render(<AgentRuntimeConfig />)
  await screen.findByText('Agent 运行时后端')
  return {
    ...utils,
    select: () => utils.container.querySelector('select') as HTMLSelectElement,
  }
}

beforeEach(() => {
  settingsGet.mockReset()
  settingsSet.mockReset()
  settingsSet.mockResolvedValue({ success: true })
})

afterEach(() => {
  cleanup()
})

describe('AgentRuntimeConfig(models.agentRuntime 开关)', () => {
  it('select 回显持久化的运行时与已存路由映射', async () => {
    const { select } = await mount(DSH_SETTINGS)
    await waitFor(() => expect(select().value).toBe('dsh'))
    expect(screen.getByDisplayValue('ds-chat')).toBeTruthy()
    expect(screen.getByDisplayValue('gpt-route')).toBeTruthy()
  })

  it('旧 settings.json 无 agentRuntime 键时按缺省 dsh 回显', async () => {
    const { select } = await mount({ models: {} })
    await waitFor(() => expect(select().value).toBe('dsh'))
  })

  it('选 dsh → settings.set(models.agentRuntime, dsh)', async () => {
    const { select } = await mount({ models: { agentRuntime: 'pi' } })
    await waitFor(() => expect(select().value).toBe('pi'))
    expect(settingsSet).not.toHaveBeenCalled()
    fireEvent.change(select(), { target: { value: 'dsh' } })
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('models.agentRuntime', 'dsh'))
  })

  it('dshRoutes 编辑区仅在 runtime === dsh 时渲染', async () => {
    const { select } = await mount({ models: { agentRuntime: 'pi' } })
    await waitFor(() => expect(select().value).toBe('pi'))
    expect(screen.queryByPlaceholderText('provider id')).toBeNull()
    fireEvent.change(select(), { target: { value: 'dsh' } })
    expect(await screen.findByPlaceholderText('provider id')).toBeTruthy()
  })

  it('改 / 删 / 增映射均以整对象写 models.dshRoutes', async () => {
    const { select } = await mount(DSH_SETTINGS)
    await waitFor(() => expect(select().value).toBe('dsh'))

    // 改: 编辑 deepseek 的路由名(两端空白裁剪), 失焦提交
    const input = screen.getByDisplayValue('ds-chat')
    fireEvent.change(input, { target: { value: ' ds-pro ' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(settingsSet).toHaveBeenCalledWith('models.dshRoutes', {
        deepseek: 'ds-pro',
        openai: 'gpt-route',
      }),
    )

    // 删: 移除 openai 一行
    fireEvent.click(screen.getByRole('button', { name: /openai/ }))
    await waitFor(() =>
      expect(settingsSet).toHaveBeenLastCalledWith('models.dshRoutes', { deepseek: 'ds-pro' }),
    )

    // 增: 追加一对 moonshot → kimi
    fireEvent.change(screen.getByPlaceholderText('provider id'), { target: { value: 'moonshot' } })
    fireEvent.change(screen.getByPlaceholderText('dsh 路由名'), { target: { value: 'kimi' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(settingsSet).toHaveBeenLastCalledWith('models.dshRoutes', {
        deepseek: 'ds-pro',
        moonshot: 'kimi',
      }),
    )
  })
})
