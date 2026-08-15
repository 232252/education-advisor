// =============================================================
// 打字指示器 — 流式输出中内容为空时的三点脉冲动画
// =============================================================

/** 三个脉冲圆点（用户消息与助手消息共用） */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.2s]" />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.4s]" />
    </span>
  )
}
