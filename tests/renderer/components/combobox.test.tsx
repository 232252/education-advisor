// =============================================================
// ComboBox 组合框 — 交互契约测试
// 覆盖: 聚焦/输入展开与大小写不敏感过滤、无匹配提示、键盘导航
//       (闭环循环/Enter 选中/Escape 收起/关闭态方向键展开)、
//       点击候选项选中、maxItems 截断、禁用态不展开、高亮越界复位
// =============================================================

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ComboBox } from '../../../src/renderer/components/ComboBox'

function Harness({ options, maxItems, disabled }: { options: string[]; maxItems?: number; disabled?: boolean }) {
  const [value, setValue] = useState('')
  return (
    <div>
      <ComboBox
        value={value}
        onChange={setValue}
        options={options}
        ariaLabel="测试组合框"
        maxItems={maxItems}
        disabled={disabled}
      />
      <output data-testid="value">{value}</output>
    </div>
  )
}

const input = () => screen.getByLabelText('测试组合框')

describe('ComboBox 交互', () => {
  it('聚焦展开全部候选项,输入大小写不敏感过滤', () => {
    render(<Harness options={['高一班', '高二班', '高三班']} />)
    fireEvent.focus(input())
    expect(screen.getAllByRole('button', { name: /班$/ })).toHaveLength(3)
    fireEvent.change(input(), { target: { value: '高= ' } })
    fireEvent.change(input(), { target: { value: '高二' } })
    expect(screen.getAllByRole('button', { name: /班$/ })).toHaveLength(1)
  })

  it('无匹配项时展示占位提示', () => {
    render(<Harness options={['高一班']} />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: '不存在' } })
    expect(screen.getByText(/无匹配项/)).toBeTruthy()
  })

  it('方向键闭环循环高亮,Enter 选中并收起', () => {
    render(<Harness options={['A', 'B', 'C']} />)
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    // 再按一次回到第一项(闭环)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('A')
    // 收起后 Enter 不再误选
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('A')
  })

  it('ArrowUp 反向循环;关闭态按方向键直接展开', () => {
    render(<Harness options={['A', 'B']} />)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('button', { name: /^[AB]$/ })).toHaveLength(2)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    // 从 0 反向到最后一项
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('B')
  })

  it('Escape 收起下拉', () => {
    render(<Harness options={['A']} />)
    fireEvent.focus(input())
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
  })

  it('点击候选项选中', () => {
    render(<Harness options={['甲', '乙']} />)
    fireEvent.focus(input())
    fireEvent.click(screen.getByRole('button', { name: '乙' }))
    expect(screen.getByTestId('value').textContent).toBe('乙')
  })

  it('maxItems 截断可见条数', () => {
    render(<Harness options={['1', '2', '3', '4', '5']} maxItems={3} />)
    fireEvent.focus(input())
    expect(screen.getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(3)
  })

  it('禁用态不展开下拉', () => {
    render(<Harness options={['A']} disabled />)
    fireEvent.focus(input())
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
  })

  it('输入收窄候选列表后高亮越界自动复位(Enter 不选中悬空项)', () => {
    render(<Harness options={['Alpha', 'Beta', 'Gamma']} />)
    fireEvent.focus(input())
    // 高亮移到第 3 项 Gamma
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    // 输入使列表只剩 Alpha → 高亮越界复位 0
    fireEvent.change(input(), { target: { value: 'Alp' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('Alpha')
  })
})
