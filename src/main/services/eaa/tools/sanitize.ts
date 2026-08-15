// =============================================================
// EAA Tools — 参数校验与安全执行(sanitizeArg / safeExecute)
// sanitizeArg 为 tools 专用(cross-spawn 非 shell 场景的防御性拦截);
// tokenizeQuery 已 re-export 统一实现(utils/sanitize.ts),消除漂移副本。
// 从 eaa-tools.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import type { EAAResult } from '../../eaa-bridge'
import { eaaBridge } from '../../eaa-bridge'

export { tokenizeQuery } from '../../../utils/sanitize'

/**
 * 检查单个参数值是否安全
 * 拒绝：控制字符、shell 元字符、以 -- 开头的值（防止参数注入）
 */
export function sanitizeArg(arg: string): void {
  // 拒绝控制字符（保留 \t \n \r）
  for (const ch of arg) {
    const code = ch.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new Error(`参数包含控制字符 (U+${code.toString(16).padStart(4, '0')})`)
    }
  }
  // 拒绝 shell 元字符
  // 修复：原正则 [class]#~!\\] 缺少 |，要求 6 字符序列才能匹配，单个 metachar 全部漏掉。
  // 现将 #、~、!、\\ 一并放入字符类，单个命中即拒绝。
  if (/[&|;`$(){}\\<>*?[\]#~!]/.test(arg)) {
    throw new Error(`参数包含非法 shell 元字符: ${JSON.stringify(arg)}`)
  }
  // 拒绝以 -- 开头的参数（防止参数注入）
  if (arg.startsWith('--')) {
    throw new Error(`参数不允许以 -- 开头: ${JSON.stringify(arg)}`)
  }
}

/**
 * 对用户提供的值做 sanitize 后转调 eaaBridge.execute
 * @param command  EAA 命令名
 * @param values   用户提供的值（将被 sanitize，不允许控制字符 / shell 元字符 / -- 开头）
 * @param flags    工具代码硬编码的 --flag 及其值（跳过 sanitize，因为是程序构造的）
 * @param signal   可选 AbortSignal(pi-agent-core 框架透传,执行中 abort 会终止子进程)
 */
async function safeExecute(
  command: string,
  values: string[],
  flags: string[] = [],
  signal?: AbortSignal,
): Promise<EAAResult> {
  for (const val of values) {
    sanitizeArg(val)
  }
  const cmd = { command, args: [...values, ...flags] }
  // 仅 signal 存在时才传第二参(保持无 signal 时单参调用契约,兼容 toHaveBeenCalledWith 断言)
  return signal ? eaaBridge.execute(cmd, { signal }) : eaaBridge.execute(cmd)
}

export { safeExecute }
