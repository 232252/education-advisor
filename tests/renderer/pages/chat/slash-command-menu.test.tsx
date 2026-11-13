// =============================================================
// SlashCommandMenu — 输入 / 时弹出的 DSH 内置指令菜单
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlashCommandMenu } from '../../../../src/renderer/pages/Chat/components/SlashCommandMenu'

afterEach(() => cleanup())

describe('SlashCommandMenu', () => {
  it('输入 / 时列出全部内置指令', () => {
    render(<SlashCommandMenu input="/" onSelect={() => {}} />)
    expect(screen.getByText('/goal')).toBeTruthy()
    expect(screen.getByText('/compact')).toBeTruthy()
    expect(screen.getByText('/export')).toBeTruthy()
  })

  it('按前缀过滤', () => {
    render(<SlashCommandMenu input="/co" onSelect={() => {}} />)
    expect(screen.getByText('/compact')).toBeTruthy()
    expect(screen.queryByText('/goal')).toBeNull()
  })

  it('中文拼写也能过滤', () => {
    render(<SlashCommandMenu input="/压" onSelect={() => {}} />)
    expect(screen.getByText('/compact')).toBeTruthy()
  })

  it('点选指令回调整行（带尾空格便于接参数）', () => {
    const onSelect = vi.fn()
    render(<SlashCommandMenu input="/" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('/compact'))
    expect(onSelect).toHaveBeenCalledWith('/compact ')
  })

  it('非斜杠输入不渲染菜单', () => {
    const { container } = render(<SlashCommandMenu input="普通消息" onSelect={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('无匹配不渲染菜单', () => {
    const { container } = render(<SlashCommandMenu input="/zzz" onSelect={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})