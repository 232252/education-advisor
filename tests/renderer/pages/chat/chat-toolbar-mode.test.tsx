// =============================================================
// ChatToolbar — 对话模式下拉（standard/plan/ptc）
// 模式写入 settings.chat.mode，主进程按模式生成行开关 patch。
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ModelSelector 挂载即拉 provider 列表，测试环境补 IPC 桩
vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    ai: {
      listProviders: async () => [],
      listModels: async () => [],
      getDshRoute: async () => null,
    },
    settings: { get: async () => ({ models: {} }) },
  }),
}))

import { ChatToolbar } from '../../../../src/renderer/pages/Chat/components/ChatToolbar'

afterEach(() => cleanup())

function mount(mode: string, onModeChange = vi.fn()) {
  render(
    <ChatToolbar
      enabledAgents={[{ id: 'main', name: '教育参谋', role: '班主任' } as never]}
      selectedAgentId="main"
      onSelectAgent={() => {}}
      thinkingLevel="medium"
      reasoningLevels={null}
      onThinkingLevelChange={() => {}}
      selectedProvider="deepseek"
      selectedModel="deepseek-chat"
      onModelSelect={() => {}}
      onClearMessages={() => {}}
      chatMode={mode}
      onModeChange={onModeChange}
    />,
  )
  return onModeChange
}

describe('ChatToolbar 对话模式', () => {
  it('渲染模式下拉并回显当前模式', () => {
    mount('plan')
    const select = screen.getByLabelText('对话模式') as HTMLSelectElement
    expect(select.value).toBe('plan')
    expect(screen.getByRole('option', { name: '普通' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '计划' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '代码编排' })).toBeTruthy()
  })

  it('切换模式回调新值', () => {
    const onModeChange = mount('standard')
    fireEvent.change(screen.getByLabelText('对话模式'), { target: { value: 'ptc' } })
    expect(onModeChange).toHaveBeenCalledWith('ptc')
  })

  it('未传模式时按普通回显（旧调用兼容）', () => {
    render(
      <ChatToolbar
        enabledAgents={[{ id: 'main', name: '教育参谋', role: '班主任' } as never]}
        selectedAgentId="main"
        onSelectAgent={() => {}}
        thinkingLevel="medium"
        reasoningLevels={null}
        onThinkingLevelChange={() => {}}
        selectedProvider="deepseek"
        selectedModel="deepseek-chat"
        onModelSelect={() => {}}
        onClearMessages={() => {}}
      />,
    )
    expect((screen.getByLabelText('对话模式') as HTMLSelectElement).value).toBe('standard')
  })
})