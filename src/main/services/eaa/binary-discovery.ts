// =============================================================
// EAA Bridge — 二进制发现 / 读缓存 / 瞬态失败重试 / 进程终止
// 从 eaa-bridge.ts 编排层下沉(纯重构,逻辑逐字搬移)
// =============================================================

import type spawn from 'cross-spawn'
import { resolveBinaryPath } from './platform'
import type { EAAResult } from './types'

/**
 * High 1.1 修复: ENOENT 后允许重新探测二进制路径。
 * 之前 binaryPath 一旦被置 null,即使二进制被恢复也无法继续使用,
 * 必须重启 app 才能恢复。现在每次 execute 入口都尝试重新 resolve。
 *
 * 尝试解析二进制路径,成功返回路径,失败返回 null(不抛错)。
 * @param mainDir 主进程模块目录(eaa-bridge.ts 的 __dirname,在编排层求值后传入)
 */
export function tryResolveBinaryPath(mainDir: string): string | null {
  try {
    return resolveBinaryPath(mainDir)
  } catch {
    return null
  }
}

/** 读缓存条目(key = `${command}:${args.join(' ')}`) */
export interface ReadCacheEntry {
  result: EAAResult
  expireAt: number
}

/**
 * 读命令结果缓存（TTL 制）。
 * EAA 读命令每次都要 spawn 一个新进程并重新解析磁盘上的 entities/events JSON，
 * 切换页面时反复拉取造成明显卡顿（仪表盘一次 7 个 spawn、学生页 1 个）。
 * 读命令命中缓存即直接返回，写命令（含 forceRefresh）清除整个缓存。
 */
export class ReadCache {
  /** 读缓存有效期（毫秒）。10 秒：足以覆盖页面来回切换，写操作即时失效。 */
  static readonly TTL_MS = 10_000
  /** 超过此条数的读缓存视为异常增长，清空并告警（防止内存泄漏）。 */
  static readonly MAX_ENTRIES = 64

  private entries = new Map<string, ReadCacheEntry>()

  /** 生成读缓存键 */
  static key(command: string, args: readonly string[]): string {
    return `${command}:${args.join(' ')}`
  }

  /** 命中且未过期时返回缓存结果,否则返回 null */
  get(key: string): EAAResult | null {
    const cached = this.entries.get(key)
    if (cached && cached.expireAt > Date.now()) return cached.result
    return null
  }

  /** 仅缓存成功结果（失败重试更有意义） */
  set(key: string, result: EAAResult): void {
    if (this.entries.size >= ReadCache.MAX_ENTRIES) this.entries.clear()
    this.entries.set(key, { result, expireAt: Date.now() + ReadCache.TTL_MS })
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * P1-10: 终止所有 in-flight EAA 子进程(SIGTERM → 不等待, 退出进程自然结束)
 * 避免退出后子进程成为孤儿并持有 .lock 文件。
 * EAA 是 spawn-per-command, 进程短生命周期, 通常退出时已无 in-flight 进程。
 * 但若退出时恰好有 agent 在调用 EAA 工具, 这些进程需要被显式终止。
 */
export function shutdownActiveProcesses(activeProcesses: Set<ReturnType<typeof spawn>>): void {
  if (activeProcesses.size === 0) return
  console.log(`[EAA] shutdown: terminating ${activeProcesses.size} in-flight process(es)`)
  for (const proc of activeProcesses) {
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already exited */
    }
  }
  activeProcesses.clear()
}
