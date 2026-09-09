// =============================================================
// 长报告渐进渲染组件(流畅度 2026-09-02 智能调优)
//
// markdown-chunks.ts 负责"安全切分",本组件负责"懒挂载":
//   - 只立即渲染前 INITIAL_CHUNKS 块 — 选中报告的首次解析/渲染成本
//     从全文降为前几块,数千行报告点击即出
//   - 其余块在滚动接近视口(rootMargin 600px)时按 2 块一批挂载,
//     KaTeX/表格的重渲染推迟到用户真正滚到那里
//   - 切换报告(content 变化)自动重置
// =============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '../../../components/Markdown'
import { splitMarkdownForLazyRender } from '../lib/markdown-chunks'

const INITIAL_CHUNKS = 3
const CHUNKS_PER_BATCH = 2

export function LazyMarkdownReport({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  // chunks 在同一 content 下不可变;id = 位置 + 内容指纹(位置即身份且不撞 key)
  const chunks = useMemo(
    () =>
      splitMarkdownForLazyRender(content).map((text, idx) => ({
        id: `${idx}:${text.length}:${text.slice(0, 16)}`,
        text,
      })),
    [content],
  )
  const [visible, setVisible] = useState(INITIAL_CHUNKS)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 切换报告 → 重置为初始可见块数
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect,chunks 身份变化即重置
  useEffect(() => {
    setVisible(INITIAL_CHUNKS)
  }, [chunks])

  useEffect(() => {
    if (visible >= chunks.length) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + CHUNKS_PER_BATCH, chunks.length))
        }
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, chunks.length])

  return (
    <div className={className}>
      {chunks.slice(0, visible).map((chunk) => (
        <Markdown key={chunk.id} content={chunk.text} />
      ))}
      {visible < chunks.length && <div ref={sentinelRef} className="h-px" />}
    </div>
  )
}
