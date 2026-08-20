// =============================================================
// EAA 执行策略 — 瞬态失败重试（M12：从 binary-discovery.ts 迁出）
//
// 职责：对 os error 5（Defender 拦截）与 [EAA_EMPTY_STDOUT]（文件锁竞争）
// 两类瞬态失败做带退避的重试。读/写路径共用同一策略，单点维护。
// =============================================================

import type { EAAResult } from './types'

/**
 * R135: os error 5 重试前等待 Windows Defender/AV 释放文件
 * Defender 实时扫描通常在 50-200ms 内完成,这里用 100ms 平衡速度与成功率
 */
export const OS_ERROR5_RETRY_DELAY_MS = 100

/**
 * P1-9 修复: 空 stdout 重试的退避基数,实际延迟 = 80ms*(attempt+1),
 * 递增以错开并发峰值。
 */
export const EMPTY_STDOUT_RETRY_BASE_DELAY_MS = 80

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 对瞬态失败(os error 5 / [EAA_EMPTY_STDOUT])做最多 2 次延迟重试
 * (提取自 EAABridge.execute 读/写路径的重试循环,逻辑逐字保留)。
 *
 * @param run 执行一次命令
 * @param matches 判断当前结果是否命中需要重试的瞬态错误标记
 * @param delayMs 第 attempt 次(1/2)重试前的等待毫秒数
 * @param label 重试日志中的命令描述(如 `read "doctor"`)
 */
export async function retryOnTransientFailure<T>(
  run: () => Promise<EAAResult<T>>,
  matches: (stderr: string) => boolean,
  delayMs: (attempt: number) => number,
  label: string,
): Promise<EAAResult<T>> {
  let result = await run()
  if (result.success || !result.stderr || !matches(result.stderr)) return result
  for (let attempt = 1; attempt <= 2; attempt++) {
    await delay(delayMs(attempt))
    console.warn(`[EAA] Retrying ${label} (attempt ${attempt}/2)`)
    result = await run()
    if (result.success || !result.stderr || !matches(result.stderr)) break
  }
  return result
}
