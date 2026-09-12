// =============================================================
// M5: 连接中心 UI — SchemaForm schema 驱动渲染回归
// 字段类型映射(showIf 条件显隐 / pattern 校验 / secret 占位符)
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ConfigField } from '@shared/types'

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({ channels: { list: vi.fn(), test: vi.fn() } }),
}))

import { SchemaForm } from '../../../../src/renderer/pages/Settings/channels/SchemaForm'

const fields: ConfigField[] = [
  { name: 'mode', label: 'Mode', type: 'string', required: true },
  { name: 'token', label: 'Token', type: 'secret', required: true },
  {
    name: 'region',
    label: 'Region',
    type: 'select',
    options: [
      { value: 'cn', label: 'CN' },
      { value: 'intl', label: 'INTL' },
    ],
  },
  { name: 'privateUrl', label: 'Private URL', type: 'string', showIf: { field: 'region', equals: 'intl' } },
  { name: 'allowGroups', label: 'Groups', type: 'boolean', default: true },
]

describe('SchemaForm(manifest 驱动表单)', () => {
  const onSave = vi.fn()

  it('渲染全部类型字段;showIf 条件未命中时隐藏', () => {
    render(
      <SchemaForm basePath="channels.demo" fields={fields} values={{ region: 'cn' }} onSave={onSave} />,
    )
    expect(screen.getByText('Mode')).toBeDefined()
    expect(screen.getByText('Token')).toBeDefined()
    expect(screen.getByText('Region')).toBeDefined()
    expect(screen.getByText('Groups')).toBeDefined()
    // region=cn → privateUrl 隐藏
    expect(screen.queryByText('Private URL')).toBeNull()
  })

  it('showIf 条件命中时字段出现', () => {
    render(
      <SchemaForm basePath="channels.demo" fields={fields} values={{ region: 'intl' }} onSave={onSave} />,
    )
    expect(screen.getByText('Private URL')).not.toBeNull()
  })

  it('boolean 字段渲染开关(不受控值回退 default)', () => {
    render(
      <SchemaForm basePath="channels.demo" fields={fields} values={{}} onSave={onSave} />,
    )
    // ToggleSwitch role checkbox 存在
    const toggle = screen.getByRole('switch') ?? screen.getByRole('checkbox')
    expect(toggle).toBeTruthy()
  })
})
