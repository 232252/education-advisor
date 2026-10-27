// =============================================================
// ContextMenu — 桌面级自定义右键菜单行为测试
// 真组件渲染 + fireEvent.contextMenu 驱动,锁定四级优先级、
// 动态禁用、剪贴板执行、事件派发、关闭语义与视口边界钳制。
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from '../../../src/renderer/components/ContextMenu'

const clipboard = vi.hoisted(() => ({
  writeText: vi.fn(),
  readText: vi.fn(),
}))

function harness() {
  const custom = document.createElement('div')
  custom.setAttribute(
    'data-ctx-menu',
    JSON.stringify([
      { label: '查看', action: 'view' },
      { label: '删除', action: 'delete', variant: 'danger' },
    ]),
  )
  custom.setAttribute('data-ctx-student-id', 'S001')
  const input = document.createElement('input')
  input.value = 'hello world'
  const plain = document.createElement('div')
  plain.textContent = 'plain area'
  const editableDiv = document.createElement('div')
  editableDiv.setAttribute('contenteditable', 'true')
  document.body.append(custom, input, plain, editableDiv)
  return { custom, input, plain, editableDiv }
}

function menuItems(): HTMLElement[] {
  return screen.queryAllByRole('menuitem')
}

describe('ContextMenu', () => {
  let els: ReturnType<typeof harness>

  beforeEach(() => {
    vi.clearAllMocks()
    els = harness()
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true,
    })
    render(<ContextMenu />)
  })
  afterEach(() => {
    cleanup()
    for (const el of [els.custom, els.input, els.plain, els.editableDiv]) el.remove()
    window.getSelection()?.removeAllRanges()
  })

  it('优先级1: data-ctx-menu 自定义菜单;点击项向目标派发 ctx-menu-action', () => {
    const got = new Promise<{ action: string; target: HTMLElement }>((res) => {
      els.custom.addEventListener('ctx-menu-action', (e) => {
        const d = (e as CustomEvent).detail
        res({ action: d.action, target: d.target })
      })
    })
    fireEvent.contextMenu(els.custom, { clientX: 100, clientY: 100 })
    const items = menuItems()
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toBe('查看')
    fireEvent.click(items[1])
    return expect(got).resolves.toMatchObject({ action: 'delete', target: els.custom })
  })

  it('优先级2: 输入框编辑菜单;无选中时 copy/cut 禁用、paste/selectAll 可用', () => {
    fireEvent.contextMenu(els.input, { clientX: 50, clientY: 50 })
    const items = menuItems() as HTMLButtonElement[]
    expect(items).toHaveLength(4)
    expect(items[0].disabled).toBe(true) // copy
    expect(items[1].disabled).toBe(true) // cut
    expect(items[2].disabled).toBe(false) // paste
    expect(items[3].disabled).toBe(false) // selectAll
  })

  it('contenteditable 同样走编辑菜单', () => {
    fireEvent.contextMenu(els.editableDiv, { clientX: 10, clientY: 10 })
    expect(menuItems()).toHaveLength(4)
  })

  it('paste: 剪贴板文本插入光标处并派发 input 事件', async () => {
    clipboard.readText.mockResolvedValue('PASTED')
    els.input.focus()
    els.input.setSelectionRange(5, 5) // hello| world
    fireEvent.contextMenu(els.input, { clientX: 10, clientY: 10 })
    const before = els.input.value
    const inputEvent = vi.fn()
    els.input.addEventListener('input', inputEvent)
    fireEvent.click(menuItems()[2]) // paste
    await waitFor(() => expect(els.input.value).toBe('helloPASTED world'))
    expect(inputEvent).toHaveBeenCalled()
    expect(before).toBe('hello world')
    expect(els.input.selectionStart).toBe(11)
  })

  it('优先级压制: 有文档选区时右键输入框仍走编辑菜单(2 压过 3)', () => {
    // 注: handler 会 focus 目标输入框,jsdom 中 focus 折叠文档选区,
    // 与真实浏览器右键输入框的交互效应一致;菜单项数证明走的是编辑菜单
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(els.plain)
    sel?.removeAllRanges()
    sel?.addRange(range)
    fireEvent.contextMenu(els.input, { clientX: 10, clientY: 10 })
    expect(menuItems()).toHaveLength(4)
  })

  it('优先级3: 非输入框但有选中文本 → 只显示复制', () => {
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(els.plain)
    sel?.removeAllRanges()
    sel?.addRange(range)
    fireEvent.contextMenu(els.plain, { clientX: 10, clientY: 10 })
    const items = menuItems() as HTMLButtonElement[]
    expect(items).toHaveLength(1)
    expect(items[0].disabled).toBe(false)
    clipboard.writeText.mockResolvedValue(undefined)
    fireEvent.click(items[0])
    return waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('plain area'))
  })

  it('优先级4: 空白区域不弹任何菜单,且默认菜单被禁用', () => {
    const notCancelled = fireEvent.contextMenu(document.body, { clientX: 1, clientY: 1 })
    // preventDefault 命中 → fireEvent 返回 false(默认菜单被禁用的证据)
    expect(notCancelled).toBe(false)
    expect(menuItems()).toHaveLength(0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('关闭语义: 菜单外 mousedown / Escape / 滚动 即关', () => {
    fireEvent.contextMenu(els.custom, { clientX: 10, clientY: 10 })
    expect(menuItems()).toHaveLength(2)
    fireEvent.mouseDown(document.body)
    expect(menuItems()).toHaveLength(0)

    fireEvent.contextMenu(els.custom, { clientX: 10, clientY: 10 })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menuItems()).toHaveLength(0)

    fireEvent.contextMenu(els.custom, { clientX: 10, clientY: 10 })
    fireEvent.scroll(window)
    expect(menuItems()).toHaveLength(0)
  })

  it('视口边界: 右下角触发时菜单位置被钳回视口内', () => {
    const x = window.innerWidth + 50
    const y = window.innerHeight + 50
    fireEvent.contextMenu(els.custom, { clientX: x, clientY: y })
    const menu = screen.getByRole('menu')
    const left = Number(menu.style.left.replace('px', ''))
    const top = Number(menu.style.top.replace('px', ''))
    expect(left).toBeLessThanOrEqual(window.innerWidth - 180 - 4)
    expect(top).toBeLessThanOrEqual(window.innerHeight - 4)
  })
})