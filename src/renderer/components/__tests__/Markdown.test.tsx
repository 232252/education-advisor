// =============================================================
// Markdown — 渲染组件测试
// 验证: GFM(标题/列表/代码/表格/链接) 正确渲染为对应 DOM
// =============================================================

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../Markdown'

describe('Markdown — 基础渲染', () => {
  it('渲染段落文本', () => {
    const { container } = render(<Markdown content="普通段落文本" />)
    expect(container.textContent).toContain('普通段落文本')
  })

  it('空内容不崩溃', () => {
    const { container } = render(<Markdown content="" />)
    expect(container.querySelector('.markdown-body')).not.toBeNull()
  })

  it('渲染标题 h1/h2/h3', () => {
    const { container } = render(<Markdown content={'# 标题一\n## 标题二\n### 标题三'} />)
    expect(container.querySelector('h1')?.textContent).toBe('标题一')
    expect(container.querySelector('h2')?.textContent).toBe('标题二')
    expect(container.querySelector('h3')?.textContent).toBe('标题三')
  })

  it('渲染粗体与行内 code', () => {
    const { container } = render(<Markdown content="**粗体** 和 `code`" />)
    expect(container.querySelector('strong')?.textContent).toBe('粗体')
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toBe('code')
  })
})

describe('Markdown — GFM 扩展', () => {
  it('渲染无序列表', () => {
    const { container } = render(<Markdown content={'- 苹果\n- 香蕉\n- 橙子'} />)
    const items = container.querySelectorAll('ul > li')
    expect(items.length).toBe(3)
    expect(items[1]?.textContent).toBe('香蕉')
  })

  it('渲染有序列表', () => {
    const { container } = render(<Markdown content={'1. 第一\n2. 第二'} />)
    const items = container.querySelectorAll('ol > li')
    expect(items.length).toBe(2)
  })

  it('渲染 GFM 表格', () => {
    const md = '| 姓名 | 分数 |\n| --- | --- |\n| 张三 | 95 |\n| 李四 | 88 |'
    const { container } = render(<Markdown content={md} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(container.querySelector('th')?.textContent).toBe('姓名')
    expect(rows[1]?.querySelectorAll('td')[0]?.textContent).toBe('李四')
  })

  it('渲染删除线 (GFM)', () => {
    const { container } = render(<Markdown content="~~删除~~" />)
    expect(container.querySelector('del')?.textContent).toBe('删除')
  })

  it('渲染任务列表 (GFM)', () => {
    const { container } = render(<Markdown content={'- [x] 完成\n- [ ] 未完成'} />)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(2)
  })
})

describe('Markdown — 链接安全', () => {
  it('链接强制 target=_blank + rel 安全属性', () => {
    const { container } = render(<Markdown content="[官网](https://example.com)" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })
})

describe('Markdown — 代码块', () => {
  it('围栏代码块渲染为 pre>code', () => {
    const { container } = render(<Markdown content={'```js\nconst x = 1\n```'} />)
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    const code = pre?.querySelector('code')
    expect(code?.textContent).toContain('const x = 1')
  })
})
