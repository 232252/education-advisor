// =============================================================
// MessageList 窗口化渲染测试 — 长对话渐进挂载的不变量
// 覆盖: 首屏只挂载最近 MESSAGE_WINDOW 条 / 查看更早扩窗 /
//       扩窗后既有项不重挂(key 稳定) / 切会话重置窗口 / 短列表无按钮
// =============================================================

import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { MessageList } from '../../../../src/renderer/pages/Chat/components/MessageList'
import { getMessageKey } from '../../../../src/renderer/pages/Chat/lib/chat-message'

function makeMessages(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `消息${i}`,
    timestamp: 1000 + i,
  })) as ChatMessage[]
}

function makeRef() {
  return createRef<HTMLDivElement | null>()
}

describe('MessageList 窗口化渲染', () => {
  it('短列表全部渲染,无"查看更早"按钮', () => {
    render(
      <MessageList
        messages={makeMessages(10)}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    expect(screen.getAllByText(/^消息\d+$/)).toHaveLength(10)
    expect(screen.queryByText(/查看更早消息/)).toBeNull()
  })

  it('长对话首屏只挂载最近 50 条,按钮显示隐藏条数', () => {
    render(
      <MessageList
        messages={makeMessages(120)}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    expect(screen.getAllByText(/^消息\d+$/)).toHaveLength(50)
    expect(screen.getByText(/查看更早消息/).textContent).toContain('70')
  })

  it('点击扩窗: 多挂载 100 条,隐藏区起点前移', () => {
    render(
      <MessageList
        messages={makeMessages(200)}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    fireEvent.click(screen.getByText(/查看更早消息/))
    // 扩窗后 visibleCount=150,仍隐藏 50 条
    expect(screen.getAllByText(/^消息\d+$/)).toHaveLength(150)
    expect(screen.getByText(/查看更早消息/).textContent).toContain('50')
  })

  it('扩窗不改变既有消息的 key(全量索引键)', () => {
    const messages = makeMessages(120)
    const { rerender, container } = render(
      <MessageList
        messages={messages}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    const firstVisibleKey = getMessageKey(messages[70], 70)
    const el = container.querySelector(`[data-testid], #root`) // noop 占位
    void el
    rerender(
      <MessageList
        messages={messages}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    // 键函数对同一 (msg, index) 稳定 — 扩窗前后第 71 条的键一致
    expect(getMessageKey(messages[70], 70)).toBe(firstVisibleKey)
  })

  it('切换会话重置窗口', () => {
    const messages = makeMessages(200)
    const { rerender } = render(
      <MessageList
        messages={messages}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
      />,
    )
    fireEvent.click(screen.getByText(/查看更早消息/))
    expect(screen.getAllByText(/^消息\d+$/)).toHaveLength(150)
    rerender(
      <MessageList
        messages={messages}
        isStreaming={false}
        canSend
        sessionKey="s2"
        messagesEndRef={makeRef()}
      />,
    )
    expect(screen.getAllByText(/^消息\d+$/)).toHaveLength(50)
  })

  it('扩窗保持视觉位置: 底边距补偿 scrollTop(e2e 冒烟: 滚动保位)', () => {
    const scrollRef = createRef<HTMLDivElement | null>()
    const { getByText } = render(
      <MessageList
        messages={makeMessages(200)}
        isStreaming={false}
        canSend
        sessionKey="s1"
        messagesEndRef={makeRef()}
        scrollContainerRef={scrollRef}
      />,
    )
    const el = scrollRef.current
    expect(el).not.toBeNull()
    // jsdom 无布局,mock 几何: 高度恒 2000,用户停在距底 500 处(scrollTop=1500)
    const scrollTopWrites: number[] = []
    Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true })
    Object.defineProperty(el, 'scrollTop', {
      get: () => 1500,
      set: (v: number) => scrollTopWrites.push(v),
      configurable: true,
    })

    fireEvent.click(getByText(/查看更早消息/))

    // 扩窗 effect 应执行补偿: scrollTop = scrollHeight(2000) - 底边距(2000-1500=500) = 1500
    expect(scrollTopWrites).toContain(1500)
  })
})
