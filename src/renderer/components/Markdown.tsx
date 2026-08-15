// =============================================================
// Markdown 渲染组件 — 用于 AI/Agent 回复
// 支持 GFM(表格/删除线/任务列表) + 数学公式(KaTeX) + 代码块
// =============================================================

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { cn } from '../lib/ui-utils'

// KaTeX 样式（数学公式渲染必需）
import 'katex/dist/katex.min.css'

interface MarkdownProps {
  content: string
  className?: string
}

function MarkdownImpl({ content, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        'markdown-body text-sm leading-relaxed break-words',
        '[&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_p]:my-2',
        '[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2',
        '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2',
        '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1',
        '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2',
        '[&_li]:my-0.5',
        '[&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 dark:[&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-gray-400 [&_blockquote]:my-2',
        '[&_hr]:border-gray-200 dark:[&_hr]:border-white/10 [&_hr]:my-3',
        '[&_table]:w-full [&_table]:text-xs [&_table]:my-2 [&_table]:border-collapse',
        '[&_th]:border [&_th]:border-gray-300 dark:[&_th]:border-white/10 [&_th]:bg-gray-50 dark:[&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border [&_td]:border-gray-300 dark:[&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
        '[&_pre]:my-2',
        '[&_code]:font-mono [&_code]:text-[0.85em]',
        '[&_img]:max-w-full [&_img]:rounded',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 行内 code 与块级 code 区分: react-markdown 对行内 code 不传 `inline` prop(v10),
          // 用 node.position 是否存在 + 是否在 pre 内来区分不可靠, 故统一: pre>code 走 .prose 样式,
          // 其余行内 code 加底色。这里用 className 钩子区分。
          code({ className: codeClass, children, ...props }) {
            // 带 language- class 的是代码块(由 pre 包裹); 否则是行内
            const isBlock = /language-/.test(codeClass ?? '')
            if (isBlock) {
              return (
                <code className={cn('prose', codeClass)} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-gray-100 dark:bg-white/10 px-1 py-0.5 text-[0.85em] text-pink-600 dark:text-pink-400"
                {...props}
              >
                {children}
              </code>
            )
          },
          // 链接安全: 强制在新窗口打开外部链接
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
