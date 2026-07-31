// =============================================================
// LLM 错误消息美化 — 主进程(飞书回复/cron 日志)与渲染进程(聊天)共用
// =============================================================

/**
 * 美化 LLM 错误消息: provider 原始错误常是 "429 {...大段 JSON...}",
 * 提取 JSON 中的人可读 message,去掉 request_id 等噪音;
 * 配额耗尽类错误补充可操作建议。非 JSON 错误原样返回。
 */
export function formatLlmError(raw: string): string {
  const jsonStart = raw.indexOf('{')
  if (jsonStart > 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { message?: unknown }
        message?: unknown
      }
      const msg = parsed?.error?.message ?? parsed?.message
      if (typeof msg === 'string' && msg.length > 0) {
        if (/用量上限|额度|积分|套餐|quota|insufficient/i.test(msg)) {
          return `${msg}\n\n> API 额度不足：请到模型服务商后台充值/升级套餐，或在「模型」页切换其他 Provider。`
        }
        return msg
      }
    } catch {
      /* 非 JSON,原样返回 */
    }
  }
  return raw
}
