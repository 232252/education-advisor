// =============================================================
// PrivacyFilteredText — P0-2 隐私过滤文本展示组件
// 包装一段文本：若 privacy 启用则用 IPC 脱敏为化名；否则原样
// 用于 ChatPage 消息气泡等长文本场景
// =============================================================

import { useEffect, useState } from 'react'
import { usePrivacyFilter } from '../hooks/usePrivacyFilter'

interface Props {
  text: string
  /** 渲染节点（默认 <span>）；用于套在已有 div 内 */
  as?: keyof JSX.IntrinsicElements
  className?: string
  /** 强制禁用脱敏（如用户主动查看的明文消息） */
  bypass?: boolean
}

export function PrivacyFilteredText({ text, as: Tag = 'span', className, bypass }: Props) {
  const { enabled, anonymize } = usePrivacyFilter()
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    let cancelled = false
    if (!enabled || bypass || !text) {
      if (!cancelled) setDisplay(text)
      return
    }
    ;(async () => {
      const mapped = await anonymize(text)
      if (!cancelled) setDisplay(mapped)
    })()
    return () => {
      cancelled = true
    }
  }, [text, enabled, bypass, anonymize])

  // biome-ignore lint/suspicious/noExplicitAny: <Tag> 是动态 JSX.IntrinsicElements key
  const Component = Tag as any
  return <Component className={className}>{display}</Component>
}
