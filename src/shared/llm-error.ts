// =============================================================
// LLM 错误消息美化 — 主进程(飞书回复/cron 日志)与渲染进程(聊天)共用
// =============================================================

/**
 * 美化 LLM 错误消息: provider 原始错误常是 "429 {...大段 JSON...}",
 * 提取 JSON 中的人可读 message,去掉 request_id 等噪音;
 * 配额耗尽类错误补充可操作建议。非 JSON 错误原样返回。
 */
export function formatLlmError(raw: string): string {
  // 无可用模型/无 key — agent-model-selector 降级链耗尽时的英文兜底,
  // 映射为带操作引导的中文(2026-08-28 审计:新用户首条消息石沉大海的主文案)
  if (
    /no model available|no (configured )?api key|api key (is )?(missing|not configured)/i.test(raw)
  ) {
    return `${raw}\n\n> 未找到可用模型：请到「模型」页配置 API Key，或安装本地模型（Ollama）后重试。`
  }
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
