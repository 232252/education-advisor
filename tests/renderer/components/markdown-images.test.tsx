import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../../../src/renderer/components/Markdown'
import { getShowChatImages, setShowChatImages } from '../../../src/renderer/lib/chat-image-pref'

afterEach(() => {
  cleanup()
  setShowChatImages(true)
})

describe('显示图片', () => {
  it('关闭时助手回复里的图片变成文字占位', () => {
    render(<Markdown images={false} content={'看这张 ![成绩单](https://example.com/a.png)'} />)
    expect(screen.getByTestId('chat-image-hidden').textContent).toBe('[成绩单]')
    expect(document.querySelector('img')).toBeNull()
  })

  it('打开时仍渲染图片', () => {
    render(<Markdown content={'![成绩单](https://example.com/a.png)'} />)
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
  })

  it('设置保存后当前值立刻变', () => {
    expect(getShowChatImages()).toBe(true)
    setShowChatImages(false)
    expect(getShowChatImages()).toBe(false)
  })
})
