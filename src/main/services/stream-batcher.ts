// =============================================================
// 流式 delta 攒批器 — 跨进程推送的节流合并
// pi-ai 按 SSE chunk 逐个产生 text_delta,一次 2000 token 的回复
// ≈ 1000-3000 次 webContents.send(每次 payload 构造 + structured clone)。
// 攒批到 windowMs(默认 33ms ≈ 30fps) 合并发送,IPC 次数降 10-100 倍,
// 渲染端流式体感无差。agent 事件链路与直连聊天链路共用。
// =============================================================

interface DeltaBatcher {
  /** 追加一段 delta(进入缓冲,窗口内合并) */
  push(delta: string): void
  /** 立即刷出缓冲(事件顺序敏感时、或流结束时必须调用,防尾部丢失) */
  flush(): void
}

export function createDeltaBatcher(
  send: (mergedDelta: string) => void,
  windowMs = 33,
): DeltaBatcher {
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (buffer) {
      const merged = buffer
      buffer = ''
      send(merged)
    }
  }

  return {
    push(delta: string) {
      buffer += delta
      if (!timer) timer = setTimeout(flush, windowMs)
    },
    flush,
  }
}
